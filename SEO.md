# GLAMBOT Jordan — SEO plan

Written for `glambotjo.com`, August 2026. Part one is what is already shipped;
part two is the work that actually moves rankings, in the order I'd do it.

---

## 1. What's live now

| Item | Status |
|---|---|
| `sitemap.xml` | 5 URLs, with image + video extensions on the homepage |
| `robots.txt` | Crawl allowed; `/admin` and `/api/` blocked; sitemap declared |
| Canonical tags | Every page self-canonicalises to one address |
| One URL per page | `/privacy` — `/privacy.html` 301-redirects to it |
| Open Graph + Twitter cards | Title, description, and a 1200×630 branded share image |
| Structured data | `LocalBusiness` + `ProfessionalService`, `Service` with the three packages, `VideoObject`, `FAQPage`, `WebSite` |
| Titles + descriptions | Rewritten around real search intent, unique per page |
| Image alt text | All 22 images described |
| Headings | One `h1`, sections under `h2` |
| Mobile | Responsive and overflow-free from 360 px to 2560 px |
| Admin pages | `noindex` by robots rule, and the shell now 302s to the login gate |

**Why the FAQ schema matters:** the questions come from real venue requirements
already on the page (3 m clearance, 147 kg, 5 m², 20 minutes). Those are exactly
what an event planner types into Google, and FAQ markup can surface them directly
in results.

---

## 2. The honest problem

**One page cannot rank for many things.** Right now the entire site is a single
document plus four legal pages. Google has one URL to rank, so it will pick one
theme — probably the brand name — and everything else competes with itself.

Brand searches ("glambot jordan") will work almost immediately. The valuable
searches — someone who does not yet know you exist — will not, until there are
pages that match them.

That is the single biggest lever here, and no amount of meta-tag tuning replaces it.

---

## 3. Keyword map

Grouped by intent. Arabic matters as much as English in this market — Jordanian
planners and brides search in both, often mixing scripts.

### Tier 1 — high intent, low competition (win these first)

| Query | Intent | Target page |
|---|---|---|
| glambot jordan / جلامبوت الاردن | brand | Home |
| glambot amman | brand + local | Home |
| robotic camera arm rental jordan | commercial | `/robotic-camera-arm` |
| تأجير ذراع كاميرا روبوت الأردن | commercial (AR) | Arabic home |
| 360 photo booth alternative amman | commercial | `/vs-360-booth` |
| slow motion video booth wedding jordan | commercial | `/weddings` |

### Tier 2 — service pages

| Query | Target page |
|---|---|
| wedding video amman / تصوير اعراس عمان | `/weddings` |
| red carpet photographer jordan | `/red-carpet` |
| brand activation video jordan | `/brand-activations` |
| corporate event video amman | `/corporate-events` |
| product video production jordan | `/product-shoots` |

### Tier 3 — informational (blog / guides, feeds the funnel)

- what is a glambot / how does a robotic camera arm work
- how much does a glambot cost in jordan *(publish only if you'll show prices)*
- best wedding venues in amman for video
- how to plan a red carpet arrival

**Note on "glambot":** the term is genuinely searched because of the Hollywood
red-carpet rigs. That is free demand — but it also means you're competing with
articles about the Oscars. Pair it with the location in every title.

---

## 4. Roadmap

### Phase 1 — foundations (this week)

1. **Point the domain at the deploy** and confirm `https://glambotjo.com` serves the
   site. Everything below assumes one live canonical host.
2. **Google Search Console** — verify the domain, submit `sitemap.xml`, request
   indexing on the homepage.
3. **Google Business Profile** — this is the highest-ROI hour of work available.
   Category "Video Production Service", service area Amman/Jordan, real photos,
   the WhatsApp number. Local pack placement often beats organic for these queries.
4. **Bing Webmaster Tools** — 5 minutes, mirrors Search Console.
5. **Confirm the Instagram URL** in `assets/app.js` (still a guess), then add it as
   `sameAs` in the structured data so the profile links to the brand entity.

### Phase 2 — the pages that rank (weeks 2–5)

Build one page per service, each 600–900 words with real photos and its own
`Service` schema:

```
/weddings              /brand-activations
/red-carpet            /corporate-events
/product-shoots        /robotic-camera-arm   (the "what is this" explainer)
```

Each needs: a unique `h1`, the occasion's own gallery, three to five real FAQs,
and a booking CTA that pre-selects that occasion — the form already supports this
via the "Book this" links.

### Phase 3 — Arabic (weeks 4–8)

Jordan is a bilingual search market and Arabic pages face far less competition.
Serve `/ar/` versions with:

```html
<link rel="alternate" hreflang="en-JO" href="https://glambotjo.com/">
<link rel="alternate" hreflang="ar-JO" href="https://glambotjo.com/ar/">
<link rel="alternate" hreflang="x-default" href="https://glambotjo.com/">
```

Translate properly — machine-translated Arabic reads badly to the audience you're
trying to convert, and Google is fine at spotting it.

### Phase 4 — authority (ongoing)

Links from Jordanian sources are what actually move the needle:

- Venue partner pages (Kempinski, Fairmont, W Amman, the golf clubs you shoot at)
- Wedding planner and event agency directories
- Local press on the tech angle — "first robotic camera arm in Jordan" is a real story
- Brands you've filmed for, crediting the work
- Supplier listings: Jordan wedding directories, event-services marketplaces

One relevant local link beats fifty directory submissions.

---

## 5. Measurement

Track monthly, not daily:

| Metric | Where | Healthy at 3 months |
|---|---|---|
| Impressions | Search Console | rising month on month |
| Clicks on non-brand queries | Search Console | > 30% of total |
| Form submissions | `/admin` dashboard | tracked per source |
| Google Business views/calls | Business Profile | steady growth |
| Core Web Vitals | Search Console | all green |

**Attribute the bookings.** The admin dashboard records every inquiry — add a
hidden `source` field to the form capturing `document.referrer` and any UTM
parameters, and you'll know within a quarter which channel actually pays.

---

## 6. Technical watch-list

- **Hero video weight.** `hero-glam.mp4` is 14 MB. It's `preload="auto"`, so it
  starts downloading immediately and will hurt Largest Contentful Paint on mobile
  data. Consider `preload="metadata"` with the poster carrying the first paint,
  and serve the poster as the LCP element.
- **Google Fonts** is a render-blocking third-party request. Self-hosting
  Montserrat would remove a DNS lookup + connection from the critical path.
- **Keep one canonical host.** Pick `https://glambotjo.com` (with or without
  `www`) and 301 everything else to it, including the Workers subdomain.
- **Don't index the Workers preview URL** — if `*.workers.dev` is publicly
  reachable, it will duplicate the whole site. Block it in robots or redirect.
- **Re-submit the sitemap** whenever you add the service pages.

---

## 7. What I would not bother with

- Meta keywords tag — dead since 2009.
- Paying for directory backlink packages — actively harmful.
- Blogging weekly for its own sake. Six strong service pages beat fifty thin posts.
- Chasing "glambot" globally. Own "glambot **jordan**" and "glambot **amman**"
  completely; the global term belongs to the Hollywood rigs and is not your buyer.
