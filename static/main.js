(() => {
  "use strict";

  const SR = 16000;
  const MAX_SECONDS = 15;
  const WEIGHTS = { audio: 0.4, melody: 0.3, lyrics: 0.3 };
  const MODES = {
    say:    { name: "Nói tên bài hát",   signals: "audio + lyrics" },
    hum:    { name: "Ngân nga (hum)",    signals: "audio + melody + lyrics" },
    lyrics: { name: "Nhớ lời bài hát",   signals: "audio + lyrics" }
  };
  const STEPS = ["Input", "Tiền xử lý", "Trích xuất", "Mã hóa", "Truy xuất", "Xếp hạng", "Kết quả"];

  const CATALOG = [
    ["Mưa tháng sáu", "Văn Mai Hương"], ["Có chắc yêu là đây", "Sơn Tùng M-TP"], ["Bước qua mùa cô đơn", "Vũ"],
    ["Nơi này có anh", "Sơn Tùng M-TP"], ["Lạ lùng", "Vũ"], ["Chạy ngay đi", "Sơn Tùng M-TP"],
    ["Hồng nhan", "Jack"], ["Lạc trôi", "Sơn Tùng M-TP"], ["Đã lỡ yêu em nhiều", "JustaTee"],
    ["Em của ngày hôm qua", "Sơn Tùng M-TP"]
  ];
  const TARGETS = [96, 82, 76, 71, 68, 63, 59, 55, 52, 48];

  const $ = (s) => document.querySelector(s);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clamp = (v, a = 0, b = 100) => Math.min(b, Math.max(a, v));
  const fuse = (a, m, l) => Math.round(WEIGHTS.audio * a + WEIGHTS.melody * m + WEIGHTS.lyrics * l);
  const mmss = (s) => String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(Math.floor(s % 60)).padStart(2, "0");
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === "text") n.textContent = v; else n.setAttribute(k, v);
    }
    kids.forEach((c) => n.append(c));
    return n;
  }
  function mulberry32(a) {
    return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  const S = { mode: "hum", busy: false, recording: false, api: { reachable: false, ready: false } };

  const stepsEl = $("#steps");
  STEPS.forEach((name, i) => {
    stepsEl.append(el("li", { class: "step", "data-state": "pending" },
      el("span", { class: "dot num", text: String(i + 1) }), el("span", { text: name })));
  });
  function setStep(n) {
    [...stepsEl.children].forEach((li, i) => {
      li.dataset.state = i < n ? "done" : i === n ? "active" : "pending";
    });
  }

  (function drawDonut() {
    const svg = $("#donut"), r = 66, C = 2 * Math.PI * r;
    const segs = [["--cyan", WEIGHTS.audio], ["--pink", WEIGHTS.melody], ["--violet", WEIGHTS.lyrics]];
    let acc = 0;
    segs.forEach(([color, w]) => {
      const len = C * w, c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      c.setAttribute("cx", 100); c.setAttribute("cy", 100); c.setAttribute("r", r);
      c.setAttribute("stroke", `var(${color})`);
      c.setAttribute("stroke-dasharray", `${len - 2} ${C - len + 2}`);
      c.setAttribute("stroke-dashoffset", String(-acc));
      svg.append(c); acc += len;
    });
  })();

  let lastList = [];
  function drawChart(list) {
    lastList = list;
    const svg = $("#chart"), NS = "http://www.w3.org/2000/svg", box = svg.parentElement;
    svg.replaceChildren();
    const L = 34, R = 8, T = 22, B = 26;
    const W = Math.max(260, Math.round(box.clientWidth)), H = Math.max(200, Math.round(box.clientHeight));
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const pw = W - L - R, ph = H - T - B, n = 10, slot = pw / n, bw = slot * 0.72;
    const y = (v) => T + ph * (1 - v / 100);
    const add = (tag, attrs, text) => { const e = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (text != null) e.textContent = text; svg.append(e); return e; };
    [0, 25, 50, 75, 100].forEach((t) => {
      add("line", { class: "gl", x1: L, x2: W - R, y1: y(t), y2: y(t) });
      add("text", { x: L - 6, y: y(t) + 4, "text-anchor": "end" }, t);
    });
    for (let i = 0; i < n; i++) {
      const v = list[i] ? list[i].match : 0, x = L + slot * i + (slot - bw) / 2, top = y(v);
      add("rect", { class: i < 3 ? "hi" : "rest", x, y: top, width: bw, height: y(0) - top, rx: 2 });
      add("text", { class: "val", x: x + bw / 2, y: top - 5, "text-anchor": "middle" }, list[i] ? v : "–");
      add("text", { x: x + bw / 2, y: H - 8, "text-anchor": "middle" }, "#" + (i + 1));
    }
  }

  function ytLink(r) {
    return "https://www.youtube.com/results?search_query=" + encodeURIComponent(r.title + " " + r.artist);
  }
  function renderResults(list, kind, extra) {
    const box = $("#list"); box.replaceChildren();
    list.slice(0, 3).forEach((r, i) => {
      const subs = el("div", { class: "subs" });
      [["Audio", r.audio], ["Melody", r.melody], ["Lyrics", r.lyrics]].forEach(([name, v]) => {
        const bar = el("i"); bar.dataset.w = clamp(v);
        subs.append(el("div", { class: "sub" }, el("span", { text: name }), el("span", { class: "track" }, bar), el("b", { class: "num", text: Math.round(v) + "%" })));
      });
      const play = el("a", { class: "play", href: ytLink(r), target: "_blank", rel: "noopener", "aria-label": "Nghe thử" });
      play.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5Z"/></svg>';
      box.append(el("article", { class: "result", "data-rank": String(i + 1) },
        el("span", { class: "rank num", text: String(i + 1).padStart(2, "0") }),
        el("span", { class: "thumb", "aria-hidden": "true", text: "♪" }),
        el("div", { class: "meta" }, el("h3", { class: "song", text: r.title }), el("p", { class: "artist", text: r.artist })),
        subs,
        el("div", { class: "end" },
          el("div", { class: "score" }, el("strong", { class: "num", text: Math.round(r.match) + "%" }), el("small", { text: "match" })),
          play)));
    });
    requestAnimationFrame(() => requestAnimationFrame(() => box.querySelectorAll(".track i").forEach((b) => { b.style.width = b.dataset.w + "%"; })));
    drawChart(list);
    const badge = $("#badge");
    badge.dataset.kind = kind;
    badge.textContent = kind === "model" ? "Model · " + extra + " ms" : "Demo · kết quả mô phỏng";
  }

  function sampleResults() {
    const subs = [[97, 95, 96], [85, 80, 79], [78, 75, 74]];
    return TARGETS.map((T, i) => {
      const [a, m, l] = subs[i] || [T + 2, T - 2, T];
      return { title: CATALOG[i][0], artist: CATALOG[i][1], audio: a, melody: m, lyrics: l, match: fuse(a, m, l) };
    });
  }

  function demoSearch(samples) {
    let h = samples.length | 0;
    for (let i = 0; i < samples.length; i += 97) h = (Math.imul(h, 31) + Math.floor((samples[i] + 1) * 1e4)) | 0;
    const rng = mulberry32(h), order = CATALOG.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const jitter = () => Math.round((rng() - 0.5) * 8);
    return order.map((ci, r) => {
      const T = clamp(TARGETS[r] + Math.round((rng() - 0.5) * 6));
      const a = clamp(T + jitter()), m = clamp(T + jitter()), l = clamp(T + jitter());
      return { title: CATALOG[ci][0], artist: CATALOG[ci][1], audio: a, melody: m, lyrics: l, match: fuse(a, m, l) };
    }).sort((x, y) => y.match - x.match);
  }

  async function toMono16k(arrayBuffer) {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC();
    let buf;
    try { buf = await ctx.decodeAudioData(arrayBuffer.slice(0)); } finally { ctx.close && ctx.close(); }
    const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(buf.duration * SR)), SR);
    const src = off.createBufferSource(); src.buffer = buf; src.connect(off.destination); src.start();
    const out = await off.startRendering();
    return out.getChannelData(0).slice(0, SR * 30);
  }

  function encodeWav(f32) {
    const buf = new ArrayBuffer(44 + f32.length * 2), v = new DataView(buf);
    const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    w(0, "RIFF"); v.setUint32(4, 36 + f32.length * 2, true); w(8, "WAVEfmt ");
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, SR, true); v.setUint32(28, SR * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    w(36, "data"); v.setUint32(40, f32.length * 2, true);
    f32.forEach((s, i) => v.setInt16(44 + i * 2, Math.round(clamp(s, -1, 1) * 32767), true));
    return new Blob([buf], { type: "audio/wav" });
  }

  function preprocess(x) {
    let peak = 0; for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
    if (peak < 1e-4) return x;
    const g = 0.95 / peak, y = x.map((s) => s * g), F = 160, thr = 0.02;
    const loud = (i) => { let m = 0; for (let k = i; k < Math.min(i + F, y.length); k++) m = Math.max(m, Math.abs(y[k])); return m > thr; };
    let a = 0, b = y.length;
    while (a < b - F && !loud(a)) a += F;
    while (b > a + F && !loud(b - F)) b -= F;
    return b - a > SR * 0.5 ? y.slice(a, b) : y;
  }

  function synthHum() {
    const n = Math.round(7.2 * SR), out = new Float32Array(n);
    const notes = [0, 2, 4, 2, 0, -3, 0, 2, 4, 5, 4, 2, 0, 2, -1, 0], seg = n / notes.length;
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const k = Math.min(notes.length - 1, Math.floor(i / seg)), t = (i % seg) / seg;
      const f = 220 * Math.pow(2, notes[k] / 12) * (1 + 0.006 * Math.sin(2 * Math.PI * 5.2 * i / SR));
      ph += 2 * Math.PI * f / SR;
      const env = Math.min(1, t * 12) * Math.min(1, (1 - t) * 8);
      out[i] = 0.5 * env * (Math.sin(ph) + 0.35 * Math.sin(2 * ph) + 0.15 * Math.sin(3 * ph)) / 1.5;
    }
    return out;
  }

  const cv = $("#wave"), g = cv.getContext("2d");
  let env = (() => { const r = mulberry32(7); return Array.from({ length: 80 }, (_, i) => 0.2 + 0.7 * Math.abs(Math.sin(i / 5.5) * (0.5 + 0.5 * r()))); })();
  function sizeCanvas() {
    const d = window.devicePixelRatio || 1, b = cv.getBoundingClientRect();
    cv.width = Math.max(1, Math.round(b.width * d)); cv.height = Math.max(1, Math.round(b.height * d)); draw();
  }
  function barCount() { return Math.max(10, Math.floor(cv.clientWidth / 7)); }
  function draw() {
    const d = window.devicePixelRatio || 1, w = cv.width, h = cv.height, n = barCount();
    g.clearRect(0, 0, w, h);
    g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--cyan").trim() || "#4ddbe8";
    const bw = 4 * d, gap = 3 * d, total = n * (bw + gap) - gap;
    let x = (w - total) / 2;
    for (let i = 0; i < n; i++) {
      const v = env.length ? env[Math.min(env.length - 1, Math.floor(i * env.length / n))] : 0.1;
      const bh = Math.max(4 * d, v * h * 0.92);
      g.beginPath(); (g.roundRect ? g.roundRect(x, (h - bh) / 2, bw, bh, bw / 2) : g.rect(x, (h - bh) / 2, bw, bh)); g.fill();
      x += bw + gap;
    }
  }
  function envelopeOf(samples, n = 96) {
    const out = [], step = Math.max(1, Math.floor(samples.length / n));
    for (let i = 0; i < n; i++) { let m = 0; for (let k = i * step; k < Math.min(samples.length, (i + 1) * step); k++) m = Math.max(m, Math.abs(samples[k])); out.push(m); }
    const mx = Math.max(...out, 1e-6); return out.map((v) => Math.max(0.06, v / mx));
  }
  new ResizeObserver(sizeCanvas).observe(cv);
  new ResizeObserver(() => { if (lastList.length) drawChart(lastList); }).observe($("#chart").parentElement);

  const micBtn = $("#micBtn"), stopBtn = $("#stopBtn"), clock = $("#clock");
  let stream = null, rec = null, chunks = [], t0 = 0, timer = 0, raf = 0, audioCtx = null;
  const notice = (t) => { $("#notice").textContent = t || ""; };

  function setBusy(b) {
    S.busy = b;
    [micBtn, stopBtn, $("#uploadBtn"), $("#sampleBtn")].forEach((x) => { x.disabled = b; });
    document.querySelectorAll(".mode").forEach((m) => { m.disabled = b; });
  }
  function setRecUi(on) {
    S.recording = on;
   $("#uploadBtn").disabled = on || S.busy; $("#sampleBtn").disabled = on || S.busy;
    document.querySelectorAll(".mode").forEach((m) => { m.disabled = on || S.busy; });
    micBtn.dataset.rec = on ? "1" : "0"; clock.dataset.rec = on ? "1" : "0";
    micBtn.setAttribute("aria-label", on ? "Dừng ghi âm" : "Bắt đầu ghi âm");
    stopBtn.textContent = on ? "Dừng" : "Ghi âm";
  }

  async function startRec() {
    if (S.busy) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
      notice("Trình duyệt không hỗ trợ ghi âm trực tiếp. Hãy tải file âm thanh lên hoặc dùng mẫu."); return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false } });
    } catch (e) {
      notice("Không mở được micro. Hãy kiểm tra lại quyền truy cập hoặc dùng file tải lên."); return;
    }
    notice("");
    chunks = []; rec = new MediaRecorder(stream);
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = onRecStop;
    const AC = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AC();
    const an = audioCtx.createAnalyser(); an.fftSize = 1024;
    audioCtx.createMediaStreamSource(stream).connect(an);
    const buf = new Uint8Array(an.fftSize); let live = [], last = 0;
    const tick = (now) => {
      raf = requestAnimationFrame(tick);
      if (now - last < 45) return; last = now;
      an.getByteTimeDomainData(buf);
      let m = 0; for (let i = 0; i < buf.length; i++) m = Math.max(m, Math.abs(buf[i] - 128) / 128);
      live.push(Math.min(1, 0.08 + m * 2.2)); const n = barCount(); if (live.length > n) live = live.slice(-n);
      env = live; draw();
    };
    rec.start(); t0 = performance.now(); setRecUi(true);
    timer = setInterval(() => {
      const s = (performance.now() - t0) / 1000; $("#clockText").textContent = mmss(s);
      if (s >= MAX_SECONDS) stopRec();
    }, 100);
    raf = requestAnimationFrame(tick);
  }

  function stopRec() {
    if (!rec || rec.state === "inactive") return;
    clearInterval(timer); cancelAnimationFrame(raf); rec.stop();
    stream.getTracks().forEach((t) => t.stop()); audioCtx && audioCtx.close && audioCtx.close();
    setRecUi(false);
  }

  async function onRecStop() {
    const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
    try { await analyse(await toMono16k(await blob.arrayBuffer())); }
    catch (e) { notice("Không đọc được bản ghi. Hãy thử lại."); setBusy(false); }
  }

  async function callApi(samples) {
    const fd = new FormData();
    fd.append("file", encodeWav(samples), "query.wav");
    fd.append("mode", S.mode);
    const t = performance.now();
    const r = await fetch("/api/predict", { method: "POST", body: fd });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || "HTTP " + r.status);
    const j = await r.json();
    const list = (j.results || []).slice(0, 10).map((x) => ({
      title: String(x.title), artist: String(x.artist),
      audio: +x.audio, melody: +x.melody, lyrics: +x.lyrics,
      match: x.match != null ? +x.match : fuse(+x.audio, +x.melody, +x.lyrics)
    }));
    if (!list.length) throw new Error("Model không trả về kết quả.");
    return { list, ms: Math.round(j.latency_ms != null ? j.latency_ms : performance.now() - t) };
  }

  async function analyse(raw) {
    setBusy(true); notice("");
    const dur = raw.length / SR;
    $("#factAudio").textContent = dur.toFixed(1) + " s · 16 kHz · mono";
    $("#clockText").textContent = mmss(dur);
    env = envelopeOf(raw); draw();

    setStep(0); await sleep(220);
    setStep(1); const clean = preprocess(raw); await sleep(320);
    setStep(2);
    
    // Liên kết thực tế với Backend API qua fetch /api/predict
    const pending = S.api.ready ? callApi(clean).then((v) => ({ ok: v }), (e) => ({ err: e })) : Promise.resolve(null);
    for (let s = 2; s <= 5; s++) { setStep(s); await sleep(380); }
    const res = await pending;
    setStep(6); await sleep(200);

    if (res && res.ok) {
      renderResults(res.ok.list, "model", res.ok.ms);
    } else {
      if (res && res.err) notice("Lỗi gọi API: " + res.err.message + ". Hiển thị kết quả demo mô phỏng.");
      renderResults(demoSearch(clean), "demo");
    }
    setStep(STEPS.length); setBusy(false);
  }

  micBtn.addEventListener("click", () => (S.recording ? stopRec() : startRec()));
  stopBtn.addEventListener("click", () => (S.recording ? stopRec() : startRec()));
  $("#sampleBtn").addEventListener("click", () => { if (!S.busy) analyse(synthHum()); });
  $("#uploadBtn").addEventListener("click", () => { if (!S.busy) $("#fileInput").click(); });
  $("#fileInput").addEventListener("change", async (e) => {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    try { await analyse(await toMono16k(await f.arrayBuffer())); }
    catch (err) { notice("Không đọc được file này. Hãy dùng file audio chuẩn (mp3, wav, m4a)."); setBusy(false); }
  });
  document.querySelectorAll(".mode").forEach((b) => b.addEventListener("click", () => {
    S.mode = b.dataset.mode;
    document.querySelectorAll(".mode").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    $("#factMode").textContent = MODES[S.mode].name; $("#factSignals").textContent = MODES[S.mode].signals;
  }));

  setStep(STEPS.length);
  renderResults(sampleResults(), "sample");
  sizeCanvas();

  // Kiểm tra trạng thái kết nối Backend & Model khi khởi động
  fetch("/api/health", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      if (!j) return;
      S.api.reachable = true; S.api.ready = !!j.model_ready;
      $("#status").classList.toggle("live", S.api.ready);
      $("#statusText").textContent = S.api.ready ? "Đã kết nối Model" : "Backend sẵn sàng · Chưa nạp model";
      if (S.api.ready) $("#foot").textContent = "Điểm kết quả lấy trực tiếp từ mô hình AI thông qua API Backend.";
    })
    .catch(() => {
      $("#statusText").textContent = "Mất kết nối Backend";
    });
})();