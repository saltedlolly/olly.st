// olly.st's only script: the Nostr key's Copy button, the current Bluesky avatar,
// the blog panel's latest posts, and the background animation (areas of colour that slowly morph, drift
// between hues and pulse). The page works without it: the blog panel still links
// to the blog, and site.css has a static gradient as the background's fallback.
//
// Kept light on purpose: one small WebGL shader with no libraries, drawn at half
// size or less and scaled up (it's all soft edges anyway), 30fps, paused while
// the tab is hidden, and a single still frame when the visitor prefers reduced
// motion or has Data Saver on.

(() => {
  setUpCopyButton();
  setUpAvatar();
  setUpPosts();

  const canvas = document.querySelector(".field");
  const gl =
    canvas &&
    canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: "low-power",
    });
  if (!gl) return;

  const VERTEX_SHADER = `
    attribute vec2 a_position;
    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;

  // Each sine below folds the page's coordinates through the one before it,
  // which is what turns plain waves into shapes that swell and melt into each
  // other. The speeds don't share a common period, so it never visibly repeats.
  //
  // The final colour is always a blend of the palette in site.css, so that
  // palette alone decides the worst-case contrast of the text on top.
  const FRAGMENT_SHADER = `
    #ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    #else
    precision mediump float;
    #endif

    uniform vec2 u_resolution;
    uniform float u_time;
    uniform vec3 u_base;
    uniform vec3 u_hues[4];

    float wave(float value) {
      return 0.5 + 0.5 * sin(value);
    }

    void main() {
      float t = u_time;
      vec2 p = gl_FragCoord.xy / min(u_resolution.x, u_resolution.y) * 1.5;

      p += 0.60 * vec2(sin(p.y * 1.3 + t * 0.42), cos(p.x * 1.1 - t * 0.35 + 1.7));
      p += 0.45 * vec2(sin(p.y * 2.1 - t * 0.52 + 4.1), cos(p.x * 1.9 + t * 0.40 + 2.3));
      p += 0.30 * vec2(sin(p.y * 3.1 + t * 0.30 + 0.6), cos(p.x * 2.7 - t * 0.48 + 5.2));

      // Which hue each area of the page is showing.
      float across = smoothstep(0.15, 0.85, wave(p.x * 1.4 + p.y * 0.4 + t * 0.22));
      float down = smoothstep(0.15, 0.85, wave(p.y * 1.2 - p.x * 0.5 - t * 0.18 + 2.0));
      vec3 hue = mix(mix(u_hues[0], u_hues[1], across), mix(u_hues[2], u_hues[3], across), down);

      // How strongly it shows: pools of colour, a wave of light rolling through
      // them about every 7 seconds, and a slower breath across the whole page.
      float pools = 0.3 + 0.7 * smoothstep(0.1, 0.9, wave(p.x * 1.1 + p.y * 1.3 + t * 0.28));
      float pulse = wave(p.x * 0.9 - p.y * 0.7 + t * 0.9);
      float breath = wave(t * 0.5);
      float strength = pools * (0.35 + 0.45 * pulse + 0.2 * breath);

      // A fraction of a shade of noise, to stop dark gradients showing bands.
      float noise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
      gl_FragColor = vec4(mix(u_base, hue, strength) + (noise - 0.5) / 255.0, 1.0);
    }
  `;

  const MAX_LONG_SIDE = 1024;
  const RESOLUTION = 0.5; // Drawn pixels per CSS pixel.
  const FRAME_INTERVAL = 1000 / 30;
  const STILL_TIME = 40; // A well-spread moment, for the single still frame.

  const root = document.documentElement;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const darkScheme = matchMedia("(prefers-color-scheme: dark)");
  const saveData = Boolean(navigator.connection && navigator.connection.saveData);

  let uniforms = null;
  let frame = 0;
  let lastDrawn = 0;
  let resizeTimer = 0;
  // Starting somewhere different makes each visit its own.
  let elapsed = Math.random() * 1000;

  if (setUp()) {
    start();
  }

  addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!uniforms) return;
      resize();
      draw();
    }, 150);
  });

  document.addEventListener("visibilitychange", start);
  reducedMotion.addEventListener("change", start);
  darkScheme.addEventListener("change", () => {
    if (!uniforms) return;
    readColours();
    draw();
  });

  // Browsers can reclaim the GPU at any time. Fall back to the CSS gradient
  // until they hand it back.
  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    stop();
    uniforms = null;
    root.classList.remove("has-field");
  });
  canvas.addEventListener("webglcontextrestored", () => {
    if (setUp()) start();
  });

  function setUp() {
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX_SHADER));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return false;
    gl.useProgram(program);

    // One triangle big enough to cover the whole screen.
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    uniforms = {
      resolution: gl.getUniformLocation(program, "u_resolution"),
      time: gl.getUniformLocation(program, "u_time"),
      base: gl.getUniformLocation(program, "u_base"),
      hues: gl.getUniformLocation(program, "u_hues"),
    };

    root.classList.add("has-field");
    readColours();
    resize();
    return true;
  }

  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return shader;
  }

  // Colours come from CSS custom properties, so the light and dark palettes
  // live in site.css alongside the rest of the theme.
  function readColours() {
    const style = getComputedStyle(root);
    const parse = (rgb) => rgb.split(",").map((part) => parseFloat(part) / 255);
    gl.uniform3fv(uniforms.base, parse(style.getPropertyValue("--field-base")));
    gl.uniform3fv(uniforms.hues, style.getPropertyValue("--field-hues").split("|").flatMap(parse));
  }

  function resize() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const scale = Math.min(RESOLUTION, MAX_LONG_SIDE / Math.max(width, height, 1));
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(uniforms.resolution, canvas.width, canvas.height);
  }

  function animating() {
    return !reducedMotion.matches && !saveData;
  }

  function start() {
    stop();
    if (!uniforms || document.hidden) return;
    if (animating()) {
      frame = requestAnimationFrame(tick);
    } else {
      draw();
    }
  }

  function stop() {
    cancelAnimationFrame(frame);
    frame = 0;
    lastDrawn = 0;
  }

  function tick(time) {
    frame = requestAnimationFrame(tick);
    if (lastDrawn && time - lastDrawn < FRAME_INTERVAL - 1) return;
    // Capped, so coming back to the tab carries on rather than jumping ahead.
    if (lastDrawn) elapsed += Math.min(time - lastDrawn, 100) / 1000;
    lastDrawn = time;
    draw();
  }

  function draw() {
    gl.uniform1f(uniforms.time, animating() ? elapsed : STILL_TIME);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // The page has a copy of the avatar, so this only swaps it if the one on
  // Bluesky has changed since. If Bluesky can't be reached, the copy stays.
  function setUpAvatar() {
    const PROFILE_URL = "https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=olly.st";
    const image = document.querySelector(".avatar img");
    if (!image) return;

    fetch(PROFILE_URL)
      .then((response) => {
        if (!response.ok) throw new Error(`Bluesky answered ${response.status}`);
        return response.json();
      })
      .then(({ avatar }) => {
        if (!avatar || avatar === image.dataset.source) return;
        if (!avatar.startsWith("https://cdn.bsky.app/")) return;
        // Loaded first, so the old picture stays until the new one is ready.
        const latest = new Image();
        latest.onload = () => {
          image.src = avatar;
        };
        latest.src = avatar;
      })
      .catch(() => {});
  }

  // The blog's latest posts. The last ones seen show straight away, then the
  // list only changes if the feed says something's new. The browser's own cache
  // stops it asking the blog more than once every 15 minutes.
  function setUpPosts() {
    const FEED_URL = "https://saltedlolly.com/feed/";
    const BLOG_ORIGIN = "https://saltedlolly.com";
    const STORAGE_KEY = "olly.st:latest-posts";
    const POST_COUNT = 3;
    const IMAGE_WIDTH = 640; // Twice the widest it's shown, for sharp screens.

    const list = document.querySelector(".posts");
    if (!list) return;

    let shown = readSaved();
    if (shown) {
      render(JSON.parse(shown));
    } else {
      showPlaceholders();
    }
    list.hidden = false;

    fetch(FEED_URL)
      .then((response) => {
        if (!response.ok) throw new Error(`Feed answered ${response.status}`);
        return response.text();
      })
      .then((text) => {
        const posts = parseFeed(text);
        const latest = JSON.stringify(posts);
        if (latest === shown) return;
        shown = latest;
        render(posts);
        save(latest);
      })
      .catch(() => {
        // Keep any saved posts. With none, the panel is just its link to the blog.
        if (!shown) list.hidden = true;
      });

    function readSaved() {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        return saved && Array.isArray(JSON.parse(saved)) ? saved : null;
      } catch {
        return null;
      }
    }

    function save(value) {
      try {
        localStorage.setItem(STORAGE_KEY, value);
      } catch {
        // Private windows can refuse. The posts just load fresh next time.
      }
    }

    function parseFeed(text) {
      const feed = new DOMParser().parseFromString(text, "application/xml");
      if (feed.querySelector("parsererror")) throw new Error("Feed isn't valid XML");

      const posts = [];
      for (const item of feed.querySelectorAll("channel > item")) {
        const read = (name) => item.getElementsByTagName(name)[0]?.textContent.trim() || "";
        const link = safeUrl(read("link"));
        const title = read("title");
        if (!title || link?.origin !== BLOG_ORIGIN) continue;
        posts.push({
          link: link.href,
          title,
          preview: read("description"),
          image: heroImage(read("content:encoded")),
        });
        if (posts.length === POST_COUNT) break;
      }
      if (!posts.length) throw new Error("No posts in the feed");
      return posts;
    }

    // The picture a post opens with. Parsed without loading anything, and asked
    // for at a smaller size when it comes from the blog's image service.
    function heroImage(content) {
      const page = new DOMParser().parseFromString(content, "text/html");
      const image = page.querySelector("body > p:first-child > img:first-child");
      const url = image && safeUrl(image.getAttribute("src"));
      if (!url || url.origin !== BLOG_ORIGIN) return null;

      const width = Number(url.searchParams.get("w"));
      const height = Number(url.searchParams.get("h"));
      if (url.pathname !== "/_image" || !width || !height) return url.href;
      url.searchParams.set("w", IMAGE_WIDTH);
      url.searchParams.set("h", Math.round((IMAGE_WIDTH * height) / width));
      url.searchParams.set("f", "webp");
      return url.href;
    }

    function safeUrl(value) {
      try {
        return new URL(value);
      } catch {
        return null;
      }
    }

    function render(posts) {
      list.removeAttribute("aria-hidden");
      list.replaceChildren(
        ...posts.map((post) => {
          const link = element("a", "post");
          link.href = post.link;
          if (post.image) {
            const image = element("img", "post__image");
            image.src = post.image;
            image.alt = ""; // The title beside it already names the link.
            image.width = IMAGE_WIDTH;
            image.height = 400;
            image.decoding = "async";
            link.append(image);
          }
          const body = element("span", "post__body");
          body.append(element("span", "post__title", post.title), element("span", "post__preview", post.preview));
          link.append(body);
          const item = element("li");
          item.append(link);
          return item;
        }),
      );
    }

    function showPlaceholders() {
      list.setAttribute("aria-hidden", "true");
      list.replaceChildren(
        ...Array.from({ length: POST_COUNT }, () => {
          const post = element("div", "post post--loading");
          post.append(element("div", "post__image"), element("div", "post__body"));
          const item = element("li");
          item.append(post);
          return item;
        }),
      );
    }

    function element(tag, className, text) {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text) node.textContent = text;
      return node;
    }
  }

  function setUpCopyButton() {
    const button = document.querySelector(".copy");
    if (!button || !navigator.clipboard || !window.isSecureContext) return;
    const status = button.nextElementSibling;
    const label = button.textContent;
    let timer = 0;
    button.hidden = false;
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(button.dataset.copy);
        button.textContent = "Copied";
        status.textContent = "Nostr key copied";
      } catch {
        button.textContent = "Couldn't copy";
        status.textContent = "Couldn't copy the Nostr key";
      }
      clearTimeout(timer);
      timer = setTimeout(() => {
        button.textContent = label;
        status.textContent = "";
      }, 2000);
    });
  }
})();
