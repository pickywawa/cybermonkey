const root = document.documentElement;
let lang = 'fr';
try { lang = new URLSearchParams(location.search).get('lang') || localStorage.getItem('cybermonkey.lang') || (navigator.language?.startsWith('en') ? 'en' : 'fr'); } catch {}
function setLang(next) {
  lang = next === 'en' ? 'en' : 'fr';
  root.lang = lang;
  try { localStorage.setItem('cybermonkey.lang', lang); } catch {}
  const title = document.querySelector('title');
  if (title?.dataset[lang]) title.textContent = title.dataset[lang];
  const button = document.getElementById('lang');
  if (button) { button.textContent = lang === 'fr' ? 'EN' : 'FR'; button.setAttribute('aria-label', lang === 'fr' ? 'Switch to English' : 'Passer en français'); }
}
setLang(lang);
document.getElementById('lang')?.addEventListener('click', () => setLang(lang === 'fr' ? 'en' : 'fr'));
document.getElementById('menu')?.addEventListener('click', () => document.querySelector('nav.main')?.classList.toggle('open'));

// Screenshot tabs
document.querySelectorAll('[data-gallery]').forEach((gallery) => {
  const tabs = [...gallery.querySelectorAll('[role=tab]')];
  const img = gallery.querySelector('.shot img');
  const captions = [...gallery.querySelectorAll('[data-caption]')];
  const select = (tab) => {
    tabs.forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
    img.src = tab.dataset.src;
    img.alt = tab.textContent.trim();
    captions.forEach((c) => (c.hidden = c.dataset.caption !== tab.dataset.id));
  };
  tabs.forEach((tab) => tab.addEventListener('click', () => select(tab)));
});
// Lightbox
const box = document.createElement('div');
box.id = 'lightbox';
box.innerHTML = '<img alt="">';
box.addEventListener('click', () => box.classList.remove('on'));
document.body.append(box);
document.addEventListener('click', (e) => {
  const shot = e.target.closest('.shot');
  if (!shot) return;
  const img = shot.querySelector('img');
  box.querySelector('img').src = img.src;
  box.classList.add('on');
});
document.addEventListener('keydown', (e) => e.key === 'Escape' && box.classList.remove('on'));
// Copy buttons on code blocks
document.querySelectorAll('pre').forEach((pre) => {
  const button = Object.assign(document.createElement('button'), { className: 'btn sm copy', textContent: 'Copy', type: 'button' });
  button.addEventListener('click', async () => { try { await navigator.clipboard.writeText(pre.innerText.replace(/^Copy\n?/, '')); button.textContent = '✓'; setTimeout(() => (button.textContent = 'Copy'), 1400); } catch {} });
  pre.append(button);
});
