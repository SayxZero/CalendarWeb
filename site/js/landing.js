import { priceValue, yearPerMonth, yearSaving } from './landingPrices.js';

// The presentation page (site/index.html). Three small jobs, no framework:
// an old share link of the planner goes on to the planner, the legal details,
// the prices and the file for Android come from the site server, and the videos
// play while they are on the screen.

// The planner moved to app/; a link "<site>/#join=<token>" made before that
// still has to open the calendar it shares.
if (location.hash.startsWith('#join=')) {
  location.replace(`app/${location.hash}`);
}

/**
 * The legal details are the operator's own file on the site server
 * (legal.json in its data folder), so that an update of the site never
 * overwrites them. Shown as values only, in the order they come.
 */
async function showLegal() {
  const footer = document.querySelector('.legal');
  const list = footer?.querySelector('.legal-list');
  if (!list) return;
  let legal;
  try {
    const response = await fetch('web/legal', { headers: { Accept: 'application/json' }, cache: 'no-cache' });
    if (!response.ok) return;
    legal = await response.json();
  } catch {
    return;
  }
  const items = [];
  const item = (icon, content) => {
    const li = document.createElement('li');
    const mark = document.createElement('span');
    mark.className = `legal-icon legal-${icon}`;
    li.append(mark, content);
    return li;
  };
  const link = (href, value) => {
    const a = document.createElement('a');
    a.href = href;
    a.textContent = value;
    return a;
  };
  if (legal.organization) items.push(item('organization', legal.organization));
  if (legal.inn) items.push(item('inn', legal.inn));
  if (legal.ogrnip) items.push(item('ogrnip', legal.ogrnip));
  if (legal.phone) items.push(item('phone', link(`tel:${legal.phone.replace(/[^\d+]/g, '')}`, legal.phone)));
  if (legal.email) items.push(item('email', link(`mailto:${legal.email}`, legal.email)));
  if (legal.offerUrl) items.push(item('offer', link(legal.offerUrl, legal.offerTitle || 'Договор оферты')));
  if (!items.length) return;
  list.replaceChildren(...items);
  footer.hidden = false;
}

/** The version for Android is whatever file the site server has; without one, "Скоро" stays. */
async function showDownloads() {
  let android = null;
  try {
    const response = await fetch('web/downloads', { headers: { Accept: 'application/json' }, cache: 'no-cache' });
    if (response.ok) ({ android } = await response.json());
  } catch {
    return;
  }
  if (!android) return;
  document.getElementById('android-version').textContent = `Версия ${android.version}`;
  const button = document.getElementById('android-download');
  button.href = android.url;
  button.hidden = false;
}

/**
 * The prices are the operator's own file on the site server too (pricing.json).
 * A price not filled in yet keeps the words the page came with. The badge of
 * the year says how much cheaper a month of it comes out, when it does.
 */
async function showPrices() {
  let pricing;
  try {
    const response = await fetch('web/pricing', { headers: { Accept: 'application/json' }, cache: 'no-cache' });
    if (!response.ok) return;
    pricing = await response.json();
  } catch {
    return;
  }
  const currency = pricing.currency || '₽';
  document.getElementById('price-free').textContent = `0 ${currency}`;
  if (pricing.month) {
    const unit = currency === '₽' ? 'руб' : currency;
    document.getElementById('free-then').textContent = `на месяц, далее ${pricing.month} ${unit}/месяц`;
  }
  for (const [id, value] of [['price-month', pricing.month], ['price-year', pricing.year]]) {
    const price = document.getElementById(id);
    if (!value) continue;
    price.textContent = `${value} ${currency}`;
    price.classList.remove('is-empty');
    price.nextElementSibling.hidden = false;
  }
  const month = priceValue(pricing.month), year = priceValue(pricing.year);
  const saving = yearSaving(month, year);
  if (saving !== null) {
    const badge = document.getElementById('year-saving');
    badge.textContent = `-${saving}%`;
    badge.hidden = false;
  }
  if (year !== null) {
    const perMonth = document.getElementById('year-per-month');
    perMonth.textContent = `${yearPerMonth(year)} ${currency} в месяц`;
    perMonth.hidden = false;
  }
}

/**
 * Videos run only while seen: a page of seven of them would otherwise load all
 * at once and keep the processor busy. Whoever asked the system for less motion
 * sees the posters, and a video starts when it is opened.
 */
function playVideosInView() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const seen = new IntersectionObserver((entries) => {
    for (const { target, isIntersecting } of entries) {
      if (isIntersecting) target.play().catch(() => {});
      else target.pause();
    }
  }, { threshold: 0.3 });
  for (const video of document.querySelectorAll('.hero-video, .shot video')) seen.observe(video);
}

/** A small video opens large, with its controls. */
function openVideosLarge() {
  const viewer = document.querySelector('.viewer');
  const large = viewer?.querySelector('video');
  if (!large) return;
  for (const shot of document.querySelectorAll('.shot')) {
    shot.addEventListener('click', () => {
      large.src = shot.querySelector('video').getAttribute('src');
      viewer.classList.toggle('viewer-phone', shot.classList.contains('shot-phone'));
      viewer.showModal();
      large.play().catch(() => {});
    });
  }
  viewer.querySelector('.viewer-close').addEventListener('click', () => viewer.close());
  viewer.addEventListener('click', (event) => { if (event.target === viewer) viewer.close(); });
  viewer.addEventListener('close', () => large.removeAttribute('src'));
}

showLegal();
showDownloads();
showPrices();
playVideosInView();
openVideosLarge();
