// Pericope — marktheword.com
// Pill nav scroll state, reveal-on-scroll, subtle hero parallax.

(() => {
  const nav = document.getElementById("nav");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Nav shadow/scale once the page scrolls past the hero fold.
  const onScroll = () => {
    nav.classList.toggle("scrolled", window.scrollY > 24);
  };
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  // Reveal on scroll.
  const revealEls = document.querySelectorAll(".reveal");
  if (reduceMotion || !("IntersectionObserver" in window)) {
    revealEls.forEach((el) => el.classList.add("in"));
  } else {
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            io.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );
    revealEls.forEach((el) => io.observe(el));
  }

  // Subtle parallax on the hero window (disabled for reduced motion).
  const parallaxEl = document.querySelector("[data-parallax]");
  if (parallaxEl && !reduceMotion) {
    const frame = parallaxEl.querySelector(".window");
    let ticking = false;
    const update = () => {
      ticking = false;
      const rect = parallaxEl.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      // progress: 0 when the shot enters, 1 when it leaves the viewport
      const progress = Math.min(1, Math.max(0, 1 - rect.top / vh));
      const lift = (progress - 0.5) * -18; // ±9px
      const tilt = (0.5 - progress) * 1.2; // ±0.6deg
      frame.style.transform = `translateY(${lift.toFixed(2)}px) perspective(1400px) rotateX(${tilt.toFixed(3)}deg)`;
    };
    const onParallaxScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    };
    update();
    window.addEventListener("scroll", onParallaxScroll, { passive: true });
    window.addEventListener("resize", onParallaxScroll, { passive: true });
  }

  // ---- Living hero: crossfade reading ↔ marking, and atmosphere switching ----
  const heroShot = document.querySelector(".hero-shot");
  const baseImg = document.querySelector(".hero-img--base");
  const THEME_SRC = {
    paper: "assets/hero-reading.png",
    ink: "assets/hero-ink.png",
    glass: "assets/hero-glass.png",
    candlelight: "assets/hero-candlelight.png",
  };

  // Preload the alternates so swaps never flash.
  Object.values(THEME_SRC).forEach((src) => {
    const im = new Image();
    im.src = src;
  });

  let cycleId = null;
  const stopCycle = () => {
    if (cycleId !== null) {
      clearInterval(cycleId);
      cycleId = null;
    }
  };

  if (heroShot && baseImg && !reduceMotion) {
    let heroVisible = true;
    // Only animate while the hero is on screen and the tab is visible.
    const tick = () => {
      if (heroVisible && !document.hidden) heroShot.classList.toggle("marking");
    };
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(
        (entries) => { heroVisible = entries[0].isIntersecting; },
        { threshold: 0.2 }
      ).observe(heroShot);
    }
    // Hold the reading state for a beat before the first mark appears.
    setTimeout(() => { cycleId = setInterval(tick, 4600); }, 2600);
  }

  // Atmosphere cards re-light the hero window. Manual choice ends the cycle.
  const atmosCards = document.querySelectorAll(".atmos-card[data-theme]");
  atmosCards.forEach((card) => {
    card.addEventListener("click", () => {
      const theme = card.dataset.theme;
      const src = THEME_SRC[theme];
      if (!src || !heroShot || !baseImg) return;

      stopCycle();
      heroShot.classList.remove("marking");

      const swap = () => {
        baseImg.src = src;
        baseImg.addEventListener("load", () => heroShot.classList.remove("swapping"), { once: true });
        // Already cached: load may not fire — clear on a beat regardless.
        setTimeout(() => heroShot.classList.remove("swapping"), 350);
      };
      heroShot.classList.add("swapping");
      setTimeout(swap, 240); // let the fade-out land before changing src

      atmosCards.forEach((c) => c.setAttribute("aria-pressed", String(c === card)));

      // Bring the hero back into view so the light change lands. Focus with
      // preventScroll and defer the smooth scroll so the browser's own
      // focus-into-view scroll can't cancel it.
      card.focus({ preventScroll: true });
      setTimeout(
        () => window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" }),
        60
      );
    });
  });
})();
