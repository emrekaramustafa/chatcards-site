// ChatCards akıllı yönlendirme modülü (03a SITE-04).
//
// Ana sayfa, /go/ ve /k/ aynı mantığı kullanır: bağlantı parametrelerini
// okur, platformu bulur ve doğru mağazaya kampanya bilgisiyle gider.
//   iOS     → App Store, `pt` + `ct` (+ `ppid`) ile (ASC kampanya bağlantısı)
//   Android → Google Play, `referrer=utm_*` (+ `listing`) ile (Install Referrer)
//   Masaüstü → iki rozet ve QR
//
// Dış bağımlılık yoktur. Saf fonksiyonlar node'da test edilir
// (website/tests/go.test.mjs); DOM'a dokunan tek yer `mount`.
//
// Site GitHub Pages'te alt dizinde yayınlanır: bu dosyada ve onu yükleyen
// sayfalarda kök-mutlak yol (`/assets/...`) KULLANILMAZ.

/** Yayın yapılandırması. Kimlikler gelince yalnızca burası değişir. */
export const CONFIG = {
  appStoreId: '6814486063',
  playPackage: 'app.chatpoz.chatpoz',

  // App Store Connect → Uygulama Analizi → Kampanyalar'daki provider token
  // (KONSOL-03). Boşken App Store bağlantısına `pt`/`ct` eklenmez: Apple `ct`'yi
  // `pt` olmadan saymaz, yarım parametreli bağlantı yalnızca gürültü olur.
  providerToken: '',

  // `k` (sayfa anahtarı) → App Store Custom Product Page kimliği (`ppid`) ve
  // Play custom store listing adı (`listing`). Kimlikler KONSOL-17'de gelir;
  // boş değerler bağlantıya eklenmez. Sözlük: docs/growth/links.md.
  pages: {
    grup: { ppid: '', listing: '' },
    iliski: { ppid: '', listing: '' },
    wrapped: { ppid: '', listing: '' },
  },

  // Çerezsiz sayaç (SITE-08): GoatCounter'ın `/count` uç noktası, örn.
  // 'https://chatcards.goatcounter.com/count'. Hesap açılınca (Emre) yazılır;
  // boşken hiçbir istek gönderilmez. Çerez yazılmaz, IP saklanmaz.
  counterEndpoint: '',

  // Mobil tarayıcıda otomatik yönlendirmeden önceki bekleme (≤300 ms).
  redirectDelayMs: 150,
};

/** Bağlantı parametreleri: kaynak, ortam, varyant, sayfa anahtarı, dil. */
export const PARAM_KEYS = ['c', 'm', 'v', 'k', 'l'];

const MAX_PARAM_LENGTH = 20;
const MAX_CAMPAIGN_LENGTH = 30;

/**
 * v1.0 uygulamasının paylaşım linkindeki `utm_content` değerlerinin kısa
 * karşılıkları. v1.1'in `v` biçimiyle (`grp_res`, `pair_chl`) aynıdır; böylece
 * iki sürümün paylaşımları aynı tabloda kıyaslanır ve `ct` 30 karakteri aşmaz.
 */
const LEGACY_CONTENT = {
  group_result: 'grp_res',
  group_challenge: 'grp_chl',
  relationship_result: 'pair_res',
  relationship_challenge: 'pair_chl',
};

/** Küçük harf, yalnızca `[a-z0-9_-]`, en fazla 20 karakter. */
export function clean(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, MAX_PARAM_LENGTH);
}

function emptyParams() {
  return { c: '', m: '', v: '', k: '', l: '' };
}

/**
 * Eski `utm_*` parametrelerini `c/m/v/k`'ye çevirir.
 *
 * Canlı v1.0 uygulaması ana sayfaya şu biçimde link veriyor:
 * `?utm_source=organic_share&utm_medium=message&utm_campaign=card_share&utm_content=group_result`.
 * Bunlar `c=share, m=v10, v=grp_res` olur: iOS'ta `ct=share_v10_grp_res`,
 * Android'de `utm_source=share` (K-faktörü ölçümü `share` kaynağına bakar).
 * Diğer `utm_*` bağlantıları alan alan eşlenir.
 */
export function fromUtm(query) {
  const source = clean(query.get('utm_source'));
  if (source === 'organic_share') {
    const content = String(query.get('utm_content') || '').toLowerCase();
    return {
      ...emptyParams(),
      c: 'share',
      m: 'v10',
      v: LEGACY_CONTENT[content] || clean(content),
    };
  }
  return {
    ...emptyParams(),
    c: source,
    m: clean(query.get('utm_medium')),
    v: clean(query.get('utm_campaign')),
    k: clean(query.get('utm_content')),
  };
}

/**
 * Sorgu dizgesinden parametreleri okur. Kısa parametreler (`c/m/v/k`) varsa
 * onlar, yoksa eski `utm_*` kullanılır. Boş kalan alanlar [defaults]'tan
 * doldurulur (ör. /k/ için `c=share`).
 */
export function readParams(search = '', defaults = {}) {
  const query = new URLSearchParams(search);
  const hasShort = ['c', 'm', 'v', 'k'].some((key) => clean(query.get(key)));
  const hasUtm = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'].some(
    (key) => clean(query.get(key)),
  );

  let params = emptyParams();
  if (hasShort) {
    for (const key of ['c', 'm', 'v', 'k']) params[key] = clean(query.get(key));
  } else if (hasUtm) {
    params = fromUtm(query);
  }
  params.l = clean(query.get('l'));

  for (const key of PARAM_KEYS) {
    if (!params[key] && defaults[key]) params[key] = clean(defaults[key]);
  }
  return params;
}

/** iOS kampanya adı: `[c, m, v]` alt çizgiyle, en fazla 30 karakter. */
export function campaignToken(params) {
  return [params.c, params.m, params.v]
    .filter(Boolean)
    .join('_')
    .slice(0, MAX_CAMPAIGN_LENGTH)
    .replace(/[_-]+$/, '');
}

function pageEntry(key, config) {
  const pages = config.pages || {};
  return (key && Object.prototype.hasOwnProperty.call(pages, key) && pages[key]) || {};
}

/** App Store bağlantısı: `pt` boşsa `ct` de eklenmez. */
export function appStoreUrl(params, config = CONFIG) {
  const query = [];
  const ct = campaignToken(params);
  if (config.providerToken) {
    query.push(`pt=${encodeURIComponent(config.providerToken)}`);
    if (ct) query.push(`ct=${encodeURIComponent(ct)}`);
  }
  query.push('mt=8');
  const { ppid } = pageEntry(params.k, config);
  if (ppid) query.push(`ppid=${encodeURIComponent(ppid)}`);
  return `https://apps.apple.com/app/apple-store/id${config.appStoreId}?${query.join('&')}`;
}

/** Play Install Referrer dizgesi: boş alanlar atlanır. */
export function installReferrer(params) {
  return [
    ['utm_source', params.c],
    ['utm_medium', params.m],
    ['utm_campaign', params.v],
    ['utm_content', params.k],
  ]
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

/** Google Play bağlantısı: `listing` ve `referrer` yalnızca doluysa. */
export function playStoreUrl(params, config = CONFIG) {
  let url = `https://play.google.com/store/apps/details?id=${config.playPackage}`;
  const { listing } = pageEntry(params.k, config);
  if (listing) url += `&listing=${encodeURIComponent(listing)}`;
  const referrer = installReferrer(params);
  if (referrer) url += `&referrer=${encodeURIComponent(referrer)}`;
  return url;
}

/** `ios`, `android` ya da `desktop`. */
export function detectPlatform(userAgent = '', maxTouchPoints = 0) {
  const ua = String(userAgent);
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  // iPadOS varsayılan olarak masaüstü Safari UA'sı gönderir; dokunmatik
  // nokta sayısı Mac'ten ayırır.
  if (/macintosh/i.test(ua) && maxTouchPoints > 1) return 'ios';
  return 'desktop';
}

/**
 * Uygulama içi tarayıcılar. Bunlarda otomatik yönlendirme mağazayı açmak
 * yerine boş ya da hatalı sayfa gösterebiliyor; tek büyük düğme gösterilir.
 */
export function detectInAppBrowser(userAgent = '') {
  const ua = String(userAgent);
  if (/instagram/i.test(ua)) return 'instagram';
  if (/FBAN|FBAV|FB_IAB|FBIOS|FB4A|MessengerForiOS/i.test(ua)) return 'facebook';
  if (/musical_ly|tiktok|bytedancewebview|trill_/i.test(ua)) return 'tiktok';
  if (/snapchat/i.test(ua)) return 'snapchat';
  return null;
}

/** Sitenin dilleri ve her dilin ana sayfası (site köküne göre, göreli). */
export const SITE_LANGUAGES = ['tr', 'en', 'pt', 'hi'];
export const LANDING_PATHS = { tr: '', en: 'en/', pt: 'pt/', hi: 'hi/' };

/** Bir BCP 47 dil etiketinin site dili: tr/az → tr, pt-* → pt, hi → hi, gerisi en. */
export function siteLanguage(tag) {
  const value = String(tag || '').toLowerCase();
  if (value.startsWith('tr') || value.startsWith('az')) return 'tr';
  if (value.startsWith('pt')) return 'pt';
  // Uygulamayla aynı eşleme: yalnızca `hi` Hintçe; en-IN ve diğer Hint
  // dilleri İngilizce.
  if (value === 'hi' || value.startsWith('hi-')) return 'hi';
  return 'en';
}

/**
 * `l` parametresi, yoksa tarayıcının ilk dili. [supported] dışındaki bir
 * sonuç İngilizceye düşer (ör. yalnızca TR/EN metni olan bir sayfa).
 */
export function pickLanguage(param, languages = [], supported = SITE_LANGUAGES) {
  const allowed = supported && supported.length ? supported : SITE_LANGUAGES;
  if (allowed.includes(param)) return param;
  const lang = siteLanguage(languages && languages[0]);
  return allowed.includes(lang) ? lang : 'en';
}

/** Arama motoru ve önizleme botları: dil yönlendirmesi yapılmaz. */
const BOT_PATTERN = /bot|crawl|spider|slurp|facebookexternalhit|embedly|lighthouse/i;

/**
 * Kök sayfadan (TR, `x-default`) tarayıcı diline uygun ana sayfaya geçiş.
 * Hedef, kampanya parametreleri kaybolmasın diye sorgu dizgesi ve çapayla
 * birlikte göreli adres olarak döner (ör. `en/?utm_source=…`); geçiş
 * gerekmiyorsa `null`.
 *
 * Geçiş yapılmayan durumlar: `l` parametresi var (kullanıcı dili seçti, ör.
 * dil bağlantısı `../?l=tr`), ziyaretçi sitenin içinden geliyor (aynı host),
 * tarayıcı dili sayfanın dili, ya da ziyaretçi bir bot. Çerez ve tarayıcı
 * deposu kullanılmaz.
 */
export function languageRedirect({
  pageLang = 'tr',
  search = '',
  hash = '',
  languages = [],
  referrer = '',
  href = '',
  userAgent = '',
} = {}) {
  const query = new URLSearchParams(search);
  if (clean(query.get('l'))) return null;
  if (BOT_PATTERN.test(String(userAgent))) return null;
  if (referrer && href) {
    try {
      if (new URL(referrer).host === new URL(href).host) return null;
    } catch (_) {
      // Bozuk referrer: dış ziyaret sayılır.
    }
  }
  const lang = pickLanguage('', languages);
  if (lang === pageLang) return null;
  const target = LANDING_PATHS[lang];
  if (target === undefined) return null;
  return `${target || './'}${search || ''}${hash || ''}`;
}

/**
 * Bir ziyaretin tüm kararları. `mode`: `redirect` (/go/, /k/: mobilde
 * mağazaya geçer) ya da `badges` (ana sayfa: yalnızca rozet bağlantıları).
 */
export function resolve({
  search = '',
  userAgent = '',
  maxTouchPoints = 0,
  languages = [],
  defaults = {},
  mode = 'redirect',
  config = CONFIG,
  languagesSupported = SITE_LANGUAGES,
} = {}) {
  const params = readParams(search, defaults);
  const platform = detectPlatform(userAgent, maxTouchPoints);
  const inApp = detectInAppBrowser(userAgent);
  const iosUrl = appStoreUrl(params, config);
  const androidUrl = playStoreUrl(params, config);
  const storeUrl =
    platform === 'ios' ? iosUrl : platform === 'android' ? androidUrl : null;
  return {
    params,
    platform,
    inApp,
    lang: pickLanguage(params.l, languages, languagesSupported),
    ct: campaignToken(params),
    iosUrl,
    androidUrl,
    storeUrl,
    autoRedirect: mode === 'redirect' && storeUrl !== null && inApp === null,
    showQr: platform === 'desktop',
  };
}

/**
 * Mağazaya geçişi başlatır. [beforeRedirect] (sayaç işareti) hata verse de
 * yönlendirme her koşulda yapılır.
 */
export function startRedirect(
  url,
  {
    beforeRedirect = () => {},
    replace = (target) => globalThis.location.replace(target),
    schedule = (fn, ms) => globalThis.setTimeout(fn, ms),
    delayMs = CONFIG.redirectDelayMs,
  } = {},
) {
  if (!url) return false;
  try {
    beforeRedirect();
  } catch (_) {
    // Ölçüm yönlendirmeyi asla engellemez.
  }
  schedule(() => replace(url), Math.min(Math.max(delayMs, 0), 300));
  return true;
}

/**
 * Sayaç yolu. Sayfa görüntüleme `/<sayfa>/<ct>` (ör. `/k/share_msg_grp_res`),
 * mağaza tıklaması `store-<ios|android>/<ct>`; `ct` yoksa `-`.
 */
export function counterPath(kind, page, ct) {
  const suffix = ct || '-';
  return kind === 'view' ? `/${page || 'home'}/${suffix}` : `store-${kind}/${suffix}`;
}

/** GoatCounter `/count` adresi; uç nokta boşsa boş dizge. */
export function counterUrl(endpoint, path, { event = false, title = '', referrer = '' } = {}) {
  if (!endpoint || !path) return '';
  const query = new URLSearchParams({ p: path });
  if (event) query.set('e', 'true');
  if (title) query.set('t', title);
  if (referrer) query.set('r', referrer);
  return `${endpoint}?${query}`;
}

/**
 * Sayaç işaretini gönderir: `sendBeacon` (sayfa kapanırken de teslim edilir),
 * yoksa `fetch(keepalive)`. Çerez yazmaz, kimlik üretmez. Hiçbir koşulda hata
 * fırlatmaz: sayaç yüklenemezse yönlendirme ve bağlantılar çalışmaya devam eder.
 */
export function count(endpoint, path, options = {}, env = globalThis) {
  try {
    const url = counterUrl(endpoint, path, options);
    if (!url) return false;
    const nav = env.navigator;
    if (nav && typeof nav.sendBeacon === 'function') return nav.sendBeacon(url) === true;
    if (typeof env.fetch === 'function') {
      env
        .fetch(url, { method: 'POST', keepalive: true, mode: 'no-cors', credentials: 'omit' })
        .catch(() => {});
      return true;
    }
  } catch (_) {
    // Sayaç asla akışı bozmaz.
  }
  return false;
}

/** Sabit sürümlü QR kütüphanesi (qrcode-generator 1.4.4, MIT), go.js'in yanında. */
export const QR_LIBRARY = 'qrcode-1.4.4.js';

/**
 * QR'ın kodlayacağı adres: o anki sayfa, parametreleriyle (atıf kaybolmaz).
 * Yalnızca `#` sonrası atılır.
 */
export function qrTarget(href) {
  return String(href || '').split('#')[0];
}

/** [qrcode] fabrikasıyla ölçeklenebilir SVG üretir (hata düzeltme M). */
export function qrSvg(qrcode, text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
}

/** QR kütüphanesini yalnızca masaüstünde, göreli adresinden yükler. */
function loadQrLibrary(doc) {
  if (typeof globalThis.qrcode === 'function') return Promise.resolve(globalThis.qrcode);
  return new Promise((resolve, reject) => {
    const script = doc.createElement('script');
    script.src = new URL(QR_LIBRARY, import.meta.url).href;
    script.async = true;
    script.onload = () =>
      typeof globalThis.qrcode === 'function'
        ? resolve(globalThis.qrcode)
        : reject(new Error('qrcode yüklenmedi'));
    script.onerror = () => reject(new Error('qrcode yüklenemedi'));
    doc.head.appendChild(script);
  });
}

/**
 * Masaüstünde `[data-qr]` kutusuna o anki adresin QR'ını çizer. Kutu CSS'te
 * yalnızca ≥900 px'te ve çizim bitince (`.ready`) görünür.
 */
export async function renderQr(doc, href) {
  const box = doc.querySelector('[data-qr]');
  const target = box && box.querySelector('[data-qr-code]');
  if (!box || !target) return false;
  try {
    const qrcode = await loadQrLibrary(doc);
    target.innerHTML = qrSvg(qrcode, qrTarget(href));
    target.setAttribute('role', 'img');
    target.setAttribute('aria-label', qrTarget(href));
    box.classList.add('ready');
    return true;
  } catch (_) {
    // QR yoksa rozetler yeterli; sayfa bozulmaz.
    return false;
  }
}

/**
 * Sayfaya bağlanır: rozet bağlantılarını kampanyalı adreslerle değiştirir,
 * platform ve dil işaretlerini `<html>`'e yazar, gerekirse yönlendirir.
 *
 * Sayfa işaretleri:
 *   `data-store="ios|android|auto"` → `href` mağaza adresi olur
 *   `data-lang="tr|en|pt|hi"`       → yalnızca seçilen dil görünür (`bilingual`)
 *
 * [pageLang] verilirse (yalnızca kök TR sayfası) ziyaretçi tarayıcı diline
 * uygun ana sayfaya, parametreleri korunarak geçirilir (`languageRedirect`).
 */
export function mount({
  page = '',
  defaults = {},
  mode = 'redirect',
  bilingual = false,
  languagesSupported = SITE_LANGUAGES,
  pageLang = '',
  config = CONFIG,
  doc = globalThis.document,
  win = globalThis.window,
} = {}) {
  const nav = win.navigator || {};
  const languages =
    nav.languages && nav.languages.length ? nav.languages : [nav.language || ''];

  if (pageLang) {
    const target = languageRedirect({
      pageLang,
      search: win.location.search,
      hash: win.location.hash,
      languages,
      referrer: doc.referrer,
      href: win.location.href,
      userAgent: nav.userAgent || '',
    });
    if (target) {
      // Sayaç ve rozetler hedef sayfada çalışır; burada yalnızca geçiş.
      win.location.replace(target);
      return { redirectedTo: target };
    }
  }

  const result = resolve({
    search: win.location.search,
    userAgent: nav.userAgent || '',
    maxTouchPoints: nav.maxTouchPoints || 0,
    languages,
    defaults,
    mode,
    config,
    languagesSupported,
  });

  const root = doc.documentElement;
  root.dataset.platform = result.platform;
  // JS yokken gizli kalan platforma özel bloklar (`data-show` CSS'i seçer).
  for (const el of doc.querySelectorAll('[data-unhide]')) el.hidden = false;
  if (result.inApp) root.dataset.inapp = result.inApp;
  if (page) root.dataset.page = page;

  if (bilingual) {
    root.lang = result.lang;
    for (const el of doc.querySelectorAll('[data-lang]')) {
      el.hidden = el.dataset.lang !== result.lang;
    }
    const title = doc.querySelector(`meta[name="title-${result.lang}"]`);
    if (title) doc.title = title.content;
    // Dile göre rozet görseli ve alt metni (`data-src-<dil>`, `data-alt-<dil>`).
    // O dilin görseli yoksa İngilizce rozet kullanılır.
    for (const img of doc.querySelectorAll('img[data-src-en], img[data-alt-en]')) {
      const src = img.getAttribute(`data-src-${result.lang}`) || img.getAttribute('data-src-en');
      if (src) img.src = src;
      const alt = img.getAttribute(`data-alt-${result.lang}`) || img.getAttribute('data-alt-en');
      if (alt) img.alt = alt;
    }
  }

  const endpoint = config.counterEndpoint;
  const storeClick = (store) =>
    count(endpoint, counterPath(store, page, result.ct), { event: true }, win);

  for (const link of doc.querySelectorAll('[data-store]')) {
    const store = link.dataset.store === 'auto' ? result.platform : link.dataset.store;
    const target = store === 'android' ? 'android' : 'ios';
    link.href = target === 'android' ? result.androidUrl : result.iosUrl;
    link.addEventListener('click', () => storeClick(target));
  }

  count(
    endpoint,
    counterPath('view', page, result.ct),
    { title: doc.title, referrer: doc.referrer },
    win,
  );

  if (result.showQr) {
    renderQr(doc, win.location.href);
  }

  if (result.autoRedirect) {
    startRedirect(result.storeUrl, {
      beforeRedirect: () => storeClick(result.platform),
      replace: (target) => win.location.replace(target),
      delayMs: config.redirectDelayMs,
    });
  }
  return result;
}
