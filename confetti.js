/* Lightweight emoji confetti — no dependencies. window.squirrelConfetti() */
(function () {
  function burst(opts) {
    opts = opts || {};
    var emojis = opts.emojis || ["🐿️", "🌰", "🎉", "✨", "💛", "💚", "❤️", "🌹"];
    var count = opts.count || 44;
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      count = 0;
    }
    var canvas = document.createElement("canvas");
    canvas.style.cssText =
      "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9999";
    document.body.appendChild(canvas);
    var ctx = canvas.getContext("2d");
    var dpr = window.devicePixelRatio || 1;
    function size() {
      canvas.width = innerWidth * dpr;
      canvas.height = innerHeight * dpr;
    }
    size();
    var parts = [];
    var originX = (opts.x != null ? opts.x : innerWidth / 2) * dpr;
    var originY = (opts.y != null ? opts.y : innerHeight * 0.35) * dpr;
    for (var i = 0; i < count; i++) {
      var ang = Math.random() * Math.PI * 2;
      var spd = (4 + Math.random() * 7) * dpr;
      parts.push({
        x: originX,
        y: originY,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - 6 * dpr,
        rot: Math.random() * Math.PI,
        va: (Math.random() - 0.5) * 0.3,
        size: (20 + Math.random() * 16) * dpr,
        em: emojis[(Math.random() * emojis.length) | 0],
        life: 1,
      });
    }
    var grav = 0.28 * dpr;
    var start = performance.now();
    function frame(now) {
      var t = now - start;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      var alive = false;
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        p.vy += grav;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.va;
        if (t > 900) p.life -= 0.02;
        if (p.life <= 0 || p.y > canvas.height + 60) continue;
        alive = true;
        ctx.save();
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.font = p.size + "px serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(p.em, 0, 0);
        ctx.restore();
      }
      if (alive && t < 4000) {
        requestAnimationFrame(frame);
      } else {
        canvas.remove();
      }
    }
    if (count > 0) requestAnimationFrame(frame);
    else canvas.remove();
  }
  window.squirrelConfetti = burst;
})();
