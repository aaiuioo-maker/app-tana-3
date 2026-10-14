// =============================================================
// アプリ棚：棚の中身（apps.json）を表示し、持ち主は iPhone から追加・削除・並べ替えができる
//   ・中身は同じフォルダの apps.json。保存すると GitHub の apps.json を直接書き換える
//   ・書き換えには GitHub の合い鍵（トークン）が要る。合い鍵はこの端末の中だけに保存する
//   ・3つの棚（app-tana / app-tana-2 / app-tana-3）で同じファイルを使う
// =============================================================
(function tana() {
  const OWNER = 'aaiuioo-maker';
  const REPO = location.pathname.split('/').filter(Boolean)[0] || 'app-tana';
  const API = 'https://api.github.com/repos/' + OWNER + '/' + REPO;
  const KEY = 'tana-token';
  const shelf = document.getElementById('shelf');
  if (!shelf) return;

  let apps = [];          // [{name, url, desc, chip, icon}]
  let sha = null;         // GitHub 上の apps.json の版（保存のときに要る）
  let editing = false;
  let dirty = false;

  const getToken = () => { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } };
  const setToken = t => { try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); } catch (e) {} };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const accent = () => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#c62a22';
  // LINE で開いてもブラウザで開くように、URL に openExternalBrowser=1 を付ける
  const shareUrl = u => /[?&]openExternalBrowser=1/.test(u) ? u : u + (u.includes('?') ? '&' : '?') + 'openExternalBrowser=1';
  const cleanUrl = u => u.replace(/([?&])openExternalBrowser=1&?/, '$1').replace(/[?&]$/, '');
  // 日本語を含む文字列を base64 にする／戻す（GitHub の API で使う）
  const toB64 = s => btoa(unescape(encodeURIComponent(s)));
  const fromB64 = s => decodeURIComponent(escape(atob(s.replace(/\s/g, ''))));

  // ---------- アイコン ----------
  function ccChar(ctx, ox, oy, p) {
    const px = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(ox + x * p, oy + y * p, w * p, h * p); };
    const o = '#d97757';
    px(2,0,8,6,o); px(0,2,2,2,o); px(10,2,2,2,o);
    px(2,6,1,2,o); px(4,6,1,2,o); px(7,6,1,2,o); px(9,6,1,2,o);
    px(3,1,1,1,'#1a1612'); px(8,1,1,1,'#1a1612');
  }
  function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); }
  // 絵で描くアイコン（アプリ本体のホーム画面アイコンと同じ絵）
  const DRAW = {
    // 近畿発 運賃表（kinki-unchin の drawIcon と同じ）
    kinki(ctx, size) {
      const s = size / 180;
      const font = n => '700 ' + (n * s) + 'px "Hiragino Kaku Gothic ProN","Yu Gothic",sans-serif';
      const poly = (pts, c) => { ctx.fillStyle = c; ctx.beginPath(); pts.forEach((q, i) => i ? ctx.lineTo(q[0]*s, q[1]*s) : ctx.moveTo(q[0]*s, q[1]*s)); ctx.closePath(); ctx.fill(); };
      const bg = ctx.createLinearGradient(0, 0, 0, size); bg.addColorStop(0, '#d9332a'); bg.addColorStop(1, '#c8231b');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, size, size);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff'; ctx.font = font(27); ctx.fillText('ゆうパック', 90*s, 31*s);
      ctx.font = font(28); ctx.fillText('近畿発', 90*s, 155*s);
      poly([[45,75],[55,55],[135,55],[125,75]], '#fbf3e6');
      poly([[125,75],[135,55],[135,115],[125,125]], '#ecd0ae');
      poly([[45,75],[125,75],[125,125],[45,125]], '#fdf0df');
      poly([[79,75],[89,55],[101,55],[91,75]], '#fde08a');
      poly([[79,75],[91,75],[91,125],[79,125]], '#fdd977');
      [[52,'〒'],[96,'¥']].forEach(a => {
        const x = a[0]; ctx.fillStyle = '#fff'; ctx.strokeStyle = '#c8231b'; ctx.lineWidth = 2*s;
        roundRect(ctx, x*s, 82*s, 22*s, 28*s, 3*s); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#c8231b'; ctx.font = font(18); ctx.fillText(a[1], (x+11)*s, 96.5*s);
      });
      ccChar(ctx, 76*s, 94*s, 1.5*s);
    },
    // 国際小包料金（kokusai-kozutsumi の画像＋左側のキャラクター）
    kokusai(ctx, size) {
      const s = size / 180, img = new Image();
      img.onload = () => { ctx.drawImage(img, 0, 0, size, size); ccChar(ctx, 14*s, 72*s, 3*s); };
      img.src = 'kokusai.png';
    }
  };
  // 頭文字のアイコン（アイコンが見つからないとき）
  function letterIcon(name, size) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const ctx = c.getContext('2d');
    ctx.fillStyle = accent(); ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '700 ' + (size * 0.5) + 'px "Hiragino Kaku Gothic ProN","Yu Gothic",sans-serif';
    ctx.fillText((name || '？').trim().charAt(0), size / 2, size / 2 + size * 0.03);
    return c.toDataURL('image/png');
  }
  function paintIcon(cv, icon, name) {
    const ctx = cv.getContext('2d'), size = cv.width;
    if (icon && icon.startsWith('draw:') && DRAW[icon.slice(5)]) { DRAW[icon.slice(5)](ctx, size); return; }
    const img = new Image();
    img.onload = () => { ctx.clearRect(0, 0, size, size); ctx.drawImage(img, 0, 0, size, size); };
    img.onerror = () => { img.onerror = null; img.src = letterIcon(name, size); };
    img.src = icon || letterIcon(name, size);
  }

  // ---------- 表示 ----------
  function render() {
    shelf.innerHTML = '';
    document.body.classList.toggle('tana-editing', editing);
    if (!apps.length && !editing) {
      shelf.appendChild(el('li', 'empty', 'まだアプリがありません。これから追加します。'));
    }
    apps.forEach((a, i) => {
      const li = el('li', 'app');
      const cv = el('canvas', 'ico'); cv.width = cv.height = 144; cv.setAttribute('aria-hidden', 'true');
      paintIcon(cv, a.icon, a.name);
      li.appendChild(cv);
      if (!editing) {
        const h2 = el('h2', null, a.name);
        if (a.chip) h2.appendChild(el('span', 'chip', a.chip));
        li.append(h2, el('p', 'desc', a.desc || ''));
        const act = el('div', 'actions');
        const open = el('a', 'btn primary', '開く');
        open.href = shareUrl(a.url); open.target = '_blank'; open.rel = 'noopener';
        const copy = el('button', 'btn copy', 'URLをコピー'); copy.type = 'button'; copy.dataset.url = shareUrl(a.url);
        act.append(open, copy);
        li.append(act, el('div', 'url', shareUrl(a.url)));
      } else {
        // 編集中：名前・説明・URL を書き換えられる。並べ替えと削除のボタン
        const f = el('div', 'tana-fields');
        const name = el('input'); name.value = a.name; name.placeholder = 'アプリの名前'; name.setAttribute('aria-label', 'アプリの名前');
        name.oninput = () => { a.name = name.value; dirty = true; };
        const desc = el('textarea'); desc.value = a.desc || ''; desc.rows = 2; desc.placeholder = '説明（なくてもよい）'; desc.setAttribute('aria-label', '説明');
        desc.oninput = () => { a.desc = desc.value; dirty = true; };
        const url = el('input'); url.value = a.url; url.type = 'url'; url.setAttribute('aria-label', 'URL');
        url.oninput = () => { a.url = cleanUrl(url.value.trim()); dirty = true; };
        f.append(name, desc, url);
        const ops = el('div', 'tana-ops');
        const up = el('button', 'btn', '↑ 上へ'); up.type = 'button'; up.disabled = i === 0;
        up.onclick = () => { apps.splice(i - 1, 0, apps.splice(i, 1)[0]); dirty = true; render(); };
        const down = el('button', 'btn', '↓ 下へ'); down.type = 'button'; down.disabled = i === apps.length - 1;
        down.onclick = () => { apps.splice(i + 1, 0, apps.splice(i, 1)[0]); dirty = true; render(); };
        const del = el('button', 'btn tana-del', '削除'); del.type = 'button';
        del.onclick = () => {
          // 1回目で「本当に削除」に変わり、もう一度押すと削除
          if (!del.classList.contains('sure')) { del.classList.add('sure'); del.textContent = 'もう一度押すと削除'; return; }
          apps.splice(i, 1); dirty = true; render();
        };
        ops.append(up, down, del);
        li.append(f, ops);
      }
      shelf.appendChild(li);
    });
    if (editing) shelf.appendChild(addCard());
    updateBar();
  }

  // ---------- 追加 ----------
  // 同じサイト（aaiuioo-maker.github.io）のアプリなら、見えない枠で開いて名前とアイコンを読み取る
  function detect(url) {
    return new Promise(res => {
      let u; try { u = new URL(url); } catch (e) { return res({}); }
      if (u.origin !== location.origin) return res({});
      const f = document.createElement('iframe');
      f.setAttribute('aria-hidden', 'true'); f.tabIndex = -1;
      f.style.cssText = 'position:fixed;left:-10000px;top:0;width:375px;height:700px;border:0;visibility:hidden';
      let done = false;
      const finish = () => {
        if (done) return; done = true;
        let name = '', href = '';
        try {
          const d = f.contentDocument;
          name = (d.querySelector('meta[name="apple-mobile-web-app-title"]') || {}).content || d.title || '';
          const l = d.querySelector('link[rel="apple-touch-icon"]') || d.querySelector('link[rel~="icon"]');
          if (l && l.getAttribute('href')) href = l.href;
        } catch (e) {}
        f.remove();
        res({ name: d0(name), href });
      };
      const d0 = s => (s || '').trim();
      f.onload = () => setTimeout(finish, 1500);   // アイコンを canvas で描くアプリのために少し待つ
      setTimeout(finish, 10000);
      f.src = url;
      document.body.appendChild(f);
    });
  }
  // アイコン画像を 120px の PNG にして apps.json に入れられる形にする
  function shrinkIcon(href) {
    return new Promise(res => {
      if (!href) return res('');
      const img = new Image();
      img.onload = () => {
        try {
          const c = document.createElement('canvas'); c.width = c.height = 120;
          c.getContext('2d').drawImage(img, 0, 0, 120, 120);
          res(c.toDataURL('image/png'));
        } catch (e) { res(''); }
      };
      img.onerror = () => res('');
      img.src = href;
    });
  }
  function addCard() {
    const li = el('li', 'app tana-add');
    const h = el('h2', null, 'アプリを追加');
    const f = el('div', 'tana-fields');
    const url = el('input'); url.type = 'url'; url.placeholder = 'https://aaiuioo-maker.github.io/…'; url.id = 'tana-new-url'; url.setAttribute('aria-label', '追加するアプリの URL');
    const name = el('input'); name.placeholder = 'アプリの名前（URL から自動で入ります）'; name.id = 'tana-new-name'; name.setAttribute('aria-label', 'アプリの名前');
    const desc = el('textarea'); desc.rows = 2; desc.placeholder = '説明（なくてもよい）'; desc.id = 'tana-new-desc'; desc.setAttribute('aria-label', '説明');
    const msg = el('p', 'tana-msg');
    f.append(url, name, desc, msg);
    const ops = el('div', 'tana-ops');
    const btn = el('button', 'btn primary', '棚に入れる'); btn.type = 'button';
    let icon = '';
    let lastLooked = '';
    async function look() {
      const u = url.value.trim();
      if (!u || u === lastLooked) return;
      lastLooked = u;
      msg.textContent = 'アプリの名前とアイコンを読み取っています…';
      const r = await detect(cleanUrl(u));
      if (r.name && !name.value) name.value = r.name;
      icon = await shrinkIcon(r.href);
      msg.textContent = r.name || icon ? '読み取りました。名前を確かめて「棚に入れる」を押してください。' : '名前とアイコンは読み取れませんでした。名前を入れてください。';
    }
    url.addEventListener('change', look);
    url.addEventListener('blur', look);
    btn.onclick = async () => {
      const u = cleanUrl(url.value.trim());
      if (!/^https?:\/\//.test(u)) { msg.textContent = 'URL は https:// から入れてください。'; url.focus(); return; }
      if (lastLooked !== url.value.trim()) await look();
      if (!name.value.trim()) { msg.textContent = 'アプリの名前を入れてください。'; name.focus(); return; }
      apps.push({ name: name.value.trim(), url: u, desc: desc.value.trim(), chip: '', icon: icon || '' });
      dirty = true; render();
      bar.msg.textContent = '追加しました。最後に「保存」を押すと、みんなの棚に出ます。';
    };
    ops.append(btn);
    li.append(h, f, ops);
    return li;
  }

  // ---------- 編集のバー（画面の下） ----------
  const bar = { box: el('div', 'tana-bar'), msg: el('p', 'tana-bar-msg') };
  bar.edit = el('button', 'btn primary', '編集'); bar.edit.type = 'button';
  bar.save = el('button', 'btn primary', '保存'); bar.save.type = 'button';
  bar.cancel = el('button', 'btn', 'やめる'); bar.cancel.type = 'button';
  bar.box.append(bar.msg, bar.cancel, bar.save, bar.edit);
  document.body.appendChild(bar.box);
  function updateBar() {
    const has = !!getToken();
    bar.box.hidden = !has;
    bar.edit.hidden = editing;
    bar.save.hidden = bar.cancel.hidden = !editing;
    bar.save.disabled = !dirty;
    if (!editing) bar.msg.textContent = '';
  }
  bar.edit.onclick = async () => {
    bar.msg.textContent = '最新の中身を読み込んでいます…';
    try { await loadFromGitHub(); } catch (e) { bar.msg.textContent = '読み込めませんでした（' + e.message + '）'; return; }
    editing = true; dirty = false; render();
    bar.msg.textContent = '名前や順番を変えたら「保存」を押してください。';
  };
  bar.cancel.onclick = async () => { editing = false; dirty = false; await loadPublic(); };
  bar.save.onclick = async () => {
    bar.save.disabled = true;
    bar.msg.textContent = '保存しています…';
    try {
      await saveToGitHub();
      editing = false; dirty = false; render();
      bar.msg.textContent = '保存しました。1〜2分で、みんなの棚に出ます。';
      setTimeout(() => { if (!editing) bar.msg.textContent = ''; }, 6000);
    } catch (e) {
      bar.save.disabled = false;
      bar.msg.textContent = '保存できませんでした（' + e.message + '）。もう一度「保存」を押してください。';
    }
  };
  // 編集中に画面を閉じようとしたら止める
  addEventListener('beforeunload', e => { if (editing && dirty) { e.preventDefault(); e.returnValue = ''; } });

  // ---------- GitHub とのやりとり ----------
  async function gh(path, opt) {
    const r = await fetch(API + path, Object.assign({ cache: 'no-store' }, opt, {
      headers: Object.assign({ Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + getToken() }, (opt || {}).headers)
    }));
    if (r.status === 401) throw new Error('合い鍵が使えません。「管理」から入れ直してください');
    if (r.status === 403 || r.status === 404) throw new Error('この棚を書き換える許可がありません');
    if (r.status === 409) throw new Error('ほかの場所で同時に直されました。「やめる」を押してからやり直してください');
    if (!r.ok) throw new Error('GitHub のエラー ' + r.status);
    return r.json();
  }
  async function loadFromGitHub() {
    const j = await gh('/contents/apps.json');
    sha = j.sha;
    apps = (JSON.parse(fromB64(j.content)).apps) || [];
  }
  async function saveToGitHub() {
    apps = apps.filter(a => a.name && a.url);
    const body = JSON.stringify({ apps }, null, 2) + '\n';
    const j = await gh('/contents/apps.json', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'アプリ棚を iPhone から更新', content: toB64(body), sha })
    });
    sha = j.content.sha;
  }
  async function loadPublic() {
    try {
      const r = await fetch('apps.json?t=' + Date.now(), { cache: 'no-store' });
      apps = (await r.json()).apps || [];
    } catch (e) {
      shelf.innerHTML = '';
      shelf.appendChild(el('li', 'empty', '棚の中身を読み込めませんでした。通信を確かめて、開き直してください。'));
      updateBar();
      return;
    }
    render();
  }

  // ---------- 管理（合い鍵を入れる） ----------
  const footer = document.querySelector('footer');
  const adminLink = el('button', 'tana-admin-link', '管理'); adminLink.type = 'button';
  const panel = el('section', 'tana-admin'); panel.hidden = true;
  panel.innerHTML =
    '<h2>管理（棚の持ち主だけ）</h2>' +
    '<p>GitHub の合い鍵（トークン）を入れると、この端末で棚のアプリを追加・削除できるようになります。合い鍵はこの端末の中だけに保存されます。</p>' +
    '<label for="tana-token">合い鍵</label>' +
    '<input id="tana-token" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="github_pat_…">' +
    '<div class="tana-ops"><button type="button" class="btn primary" id="tana-token-save">合い鍵を入れる</button><button type="button" class="btn" id="tana-token-clear">この端末から消す</button></div>' +
    '<p class="tana-msg" id="tana-token-msg"></p>';
  if (footer) { footer.prepend(adminLink); footer.after(panel); } else { document.body.append(adminLink, panel); }
  adminLink.onclick = () => { panel.hidden = !panel.hidden; if (!panel.hidden) panel.scrollIntoView({ behavior: 'smooth' }); showTokenState(); };
  const tmsg = panel.querySelector('#tana-token-msg');
  function showTokenState() { tmsg.textContent = getToken() ? 'この端末には合い鍵が入っています。下の「編集」から直せます。' : ''; }
  panel.querySelector('#tana-token-save').onclick = async () => {
    const input = panel.querySelector('#tana-token');
    const t = input.value.trim();
    if (!t) { tmsg.textContent = '合い鍵を貼り付けてください。'; return; }
    tmsg.textContent = '確かめています…';
    try {
      const r = await fetch(API, { cache: 'no-store', headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + t } });
      const j = r.ok ? await r.json() : null;
      if (!j || !j.permissions || !j.permissions.push) throw new Error();
      setToken(t); input.value = '';
      tmsg.textContent = '合い鍵を入れました。画面の下の「編集」から、アプリを追加・削除できます。';
      updateBar();
    } catch (e) {
      tmsg.textContent = 'この合い鍵では「' + REPO + '」を書き換えられません。作るときに、この棚を選んで「Contents」を「Read and write」にしてください。';
    }
  };
  panel.querySelector('#tana-token-clear').onclick = () => { setToken(''); editing = false; tmsg.textContent = 'この端末から合い鍵を消しました。'; render(); };

  // ---------- URLをコピー ----------
  shelf.addEventListener('click', e => {
    const b = e.target.closest('.copy'); if (!b) return;
    const url = b.dataset.url, label = 'URLをコピー';
    const done = t => { b.textContent = t; setTimeout(() => { b.textContent = label; }, 1600); };
    const sel = () => {
      const u = b.closest('.app').querySelector('.url');
      const r = document.createRange(); r.selectNodeContents(u);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      done('URLを選択しました');
    };
    try { navigator.clipboard.writeText(url).then(() => done('コピーしました'), sel); } catch (err) { sel(); }
  });

  loadPublic();
})();
