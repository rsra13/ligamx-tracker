# Liga MX Tracker

A clean, ad-free Liga MX companion site: live scores, standings, top scorers,
clean sheets, team cards, and per-match details (goals, cards, stats).

**Cost: $0.** No API keys, no backend, no build step, no paid services.

## How it works

- Pure static site: `index.html` + `css/styles.css` + `js/app.js`. No frameworks,
  no dependencies, no trackers, no ads.
- On every visit the page fetches fresh data directly from ESPN's free public
  API (`site.api.espn.com/.../soccer/mex.1`) — scoreboard, monthly results, and
  match summaries. Nothing is hard-coded, so the site updates itself:
  - **Partidos** auto-refreshes every 30 seconds (live minute badges).
  - **Tabla / Goleadores / Equipos** are computed from the current tournament's
    matches (Apertura/Clausura detected automatically) and refresh whenever you
    open the tab or return to the page.
- If you're offline, it shows the last saved data with a notice.
- All times are shown in your device's local timezone.

## Put it online for free (GitHub Pages)

1. Create a free account at github.com (if you don't have one).
2. Create a new **public** repository, e.g. `ligamx-tracker`. Don't add a README.
3. Upload these files keeping the folder structure:
   - `index.html`
   - `css/styles.css`
   - `js/app.js`
   (Easiest: on the repo page click *Add file → Upload files* and drag the
   three files in — GitHub preserves folders.)
4. Go to **Settings → Pages**, set *Source* to **Deploy from a branch**,
   branch **main**, folder **/ (root)**, and save.
5. After a minute your site is live at `https://TU-USUARIO.github.io/ligamx-tracker/`.

That's it — every visit pulls the latest data automatically. To change anything,
just edit/upload the files again; no rebuild or redeploy step needed.

### Alternatives (also free)

- **Netlify Drop**: drag the folder onto app.netlify.com/drop — instant site.
- **Cloudflare Pages**: free, fast, same drag-and-drop flow.

## Files

```
ligamx/
├── index.html      # structure + tabs
├── css/styles.css  # dark mobile-first theme
├── js/app.js       # data fetching, rendering, auto-refresh
└── README.md
```

## Notes

- Data: ESPN public API (unofficial endpoints; free, no key). If ESPN ever
  changes them, only `js/app.js` needs a small update.
- The standings, top scorers and clean sheets are computed from regular-season
  matches (jornadas 1–17), matching the official tables.
- Open `index.html?debug=1` in a browser to see a diagnostics panel of the
  data fetches.
