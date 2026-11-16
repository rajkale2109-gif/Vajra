import { Objective, Platform, CampaignStatus } from '../calculations/types.js';

export interface RawCampaignDef {
  id: number;
  name: string;
  plat: Platform;
  obj: Objective;
  status: CampaignStatus;
  raw: string;
  start: string;
  end: string;
  sync: string;
  q: string;
  nm?: string;
  impr: number;
  clicks: number;
  spend: number;
  pImpr: number;
  pClicks: number;
  pSpend: number;
  reach?: number;
  pReach?: number;
  eng?: number;
  pEng?: number;
  conv?: number;
  pConv?: number;
  rev?: number;
  pRev?: number;
  budget: number;
  spent: number;
}

export interface RawAdSetDef {
  id: string;
  cid: number;
  name: string;
  aud: string;
  status: CampaignStatus;
  q: string;
  impr: number;
  clicks: number;
  spend: number;
  pImpr: number;
  pClicks: number;
  pSpend: number;
  reach?: number;
  pReach?: number;
  eng?: number;
  pEng?: number;
  conv?: number;
  pConv?: number;
  rev?: number;
  pRev?: number;
}

export function generateSampleData() {
  const L: [string, Platform, Objective, CampaignStatus][] = [
    ["Summer AC Awareness", "Meta", "Awareness", "Active"],
    ["Inverter AC Search", "Google", "Traffic", "Active"],
    ["Window AC Leads", "Meta", "Leads", "Active"],
    ["Split AC Brand Search", "Google", "Traffic", "Active"],
    ["Diwali Cooling Offers", "Meta", "Sales", "Active"],
    ["Premium AC Launch Teaser", "Meta", "Awareness", "Learning"],
    ["Smart AC App Install", "Google", "App Promotion", "Active"],
    ["Heatwave Reels Engagement", "Meta", "Engagement", "Active"],
    ["Pune Lead Gen", "Meta", "Leads", "Active"],
    ["Summer Display Remarketing", "Google", "Sales", "Learning"],
    ["Festive EMI Offers", "Google", "Sales", "Active"],
    ["Mumbai Showroom Traffic", "Meta", "Traffic", "Active"],
    ["Gen Z Cooling Video", "Meta", "Awareness", "Paused"],
    ["Dealer Locator Search", "Google", "Traffic", "Active"],
    ["Monsoon Dehumidifier Promo", "Meta", "Sales", "Ended"],
    ["Hyderabad Lead Gen", "Google", "Leads", "Active"],
    ["AC Service Plans Leads", "Meta", "Leads", "Active"],
    ["Smart AC App Engagement", "Meta", "Engagement", "Active"],
    ["Premium Inverter YouTube", "Google", "Awareness", "Active"],
    ["Delhi NCR Lead Gen", "Meta", "Leads", "Paused"],
    ["Eco Star Rating Search", "Google", "Traffic", "Active"],
    ["Summer Sale Catalogue", "Meta", "Sales", "Active"],
    ["Winter Heater Promo", "Google", "Sales", "Ended"],
    ["App Reinstall Push", "Google", "App Promotion", "Active"],
    ["Cooling Calculator Engagement", "Meta", "Engagement", "Active"],
    ["Pan-India Brand Awareness", "Google", "Awareness", "Active"],
  ];

  const OC: Record<Objective, string> = {
    Awareness: "OT",
    Traffic: "SEA",
    Engagement: "EN",
    Leads: "MT",
    Sales: "SL",
    "App Promotion": "AP",
  };

  const BC: Record<Objective, number> = {
    Awareness: 0.012,
    Traffic: 0.03,
    Engagement: 0.045,
    Leads: 0.022,
    Sales: 0.026,
    "App Promotion": 0.02,
  };

  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  const CAMP: RawCampaignDef[] = L.map((l, i) => {
    const im = 40000 + rnd() * 110000;
    const ck = im * BC[l[2]] * (1.2 + rnd() * 0.8);
    const u = 0.35 + rnd() * 0.35;
    return {
      id: i,
      raw: `R167/${OC[l[2]]}/24/${998274 + i}/${String(i).padStart(2, "0")}_${l[0].replace(/ /g, "_")}`,
      name: l[0],
      plat: l[1],
      obj: l[2],
      status: l[3],
      impr: im,
      clicks: ck,
      spend: ck * (18 + rnd() * 16),
      pImpr: 0,
      pClicks: 0,
      pSpend: 0,
      q: "ok",
      start: "2026-09-0" + (1 + (i % 8)),
      end: l[3] === "Ended" ? "2026-10-25" : i % 2 ? "2026-12-31" : "2026-11-30",
      sync: l[1] === "Meta" ? "Nov 15, 08:40" : "Nov 15, 08:15",
      budget: 0,
      spent: 0,
    };
  });

  const piRatios = L.map(() => 0.85 + rnd() * 0.3);
  const pkRatios = L.map(() => 0.8 + rnd() * 0.4);
  const psRatios = L.map(() => 0.85 + rnd() * 0.3);
  const uRatios = L.map(() => 0.35 + rnd() * 0.35);

  const TI = [2480000, 72400, 1845000];
  const FIX = [5];

  const sc = (k: 'impr' | 'clicks' | 'spend', tot: number, fx: number[]) => {
    const sk = CAMP.filter((c) => FIX.includes(c.id) || fx.includes(c.id));
    const o = CAMP.filter((c) => !sk.includes(c));
    const sumSk = sk.reduce((a, c) => a + c[k], 0);
    const sumO = o.reduce((a, c) => a + c[k], 0);
    const f = (tot - sumSk) / sumO;
    o.forEach((c) => {
      c[k] = Math.round(c[k] * f);
    });
  };

  Object.assign(CAMP[5], { impr: 640, clicks: 9, spend: 190, q: "insufficient" });
  sc("impr", TI[0], []);
  CAMP[0].clicks = Math.round(CAMP[0].impr * 0.026);
  sc("clicks", TI[1], [0]);
  sc("spend", TI[2], []);

  (["impr", "clicks", "spend"] as const).forEach((k, i) => {
    CAMP[25][k] += TI[i] - CAMP.reduce((a, c) => a + c[k], 0);
  });

  CAMP.forEach((c, idx) => {
    c.pImpr = Math.round(c.impr * piRatios[idx]);
    c.pClicks = Math.round(c.clicks * pkRatios[idx]);
    c.pSpend = Math.round(c.spend * psRatios[idx]);
    c.budget = Math.round((c.spend * 4.3 * 1.1) / 1000) * 1000;
    c.spent = Math.round(c.budget * uRatios[idx]);
  });

  // Specific prototype overrides
  Object.assign(CAMP[0], {
    clicks: Math.round(CAMP[0].impr * 0.026),
    pImpr: CAMP[0].impr,
    pClicks: Math.round(CAMP[0].impr * 0.035),
  });
  Object.assign(CAMP[2], {
    pClicks: CAMP[2].clicks,
    pSpend: Math.round(CAMP[2].spend / 1.32),
  });
  Object.assign(CAMP[5], {
    pImpr: 520,
    pClicks: 6,
    pSpend: 150,
    budget: 20000,
    spent: 6200,
  });
  Object.assign(CAMP[21], {
    pImpr: CAMP[21].impr,
    pClicks: Math.round(CAMP[21].clicks / 0.78),
  });
  Object.assign(CAMP[6], { q: "delayed", sync: "Nov 14, 21:10" });
  Object.assign(CAMP[9], { pImpr: 0, pClicks: 0, pSpend: 0 });
  Object.assign(CAMP[10], { spent: Math.round(CAMP[10].budget * 0.88) });

  // 26 & 27
  CAMP.push(
    {
      id: 26,
      raw: "R167/OT/24/998300/26_New_AC_Launch_Setup",
      name: "New AC Launch Setup",
      plat: "Meta",
      obj: "Awareness",
      status: "Active",
      nm: "noadsets",
      q: "noadsets",
      impr: 0,
      clicks: 0,
      spend: 0,
      pImpr: 0,
      pClicks: 0,
      pSpend: 0,
      budget: 150000,
      spent: 0,
      start: "2026-11-14",
      end: "2026-12-31",
      sync: "Nov 15, 08:40",
    },
    {
      id: 27,
      raw: "R167/MT/24/998301/27_Dealer_Lead_Form_Push",
      name: "Dealer Lead Form Push",
      plat: "Google",
      obj: "Leads",
      status: "Active",
      nm: "failed",
      q: "failed",
      impr: 0,
      clicks: 0,
      spend: 0,
      pImpr: 0,
      pClicks: 0,
      pSpend: 0,
      budget: 120000,
      spent: 0,
      start: "2026-10-20",
      end: "2026-12-15",
      sync: "Nov 11, 18:30",
    }
  );

  const AUD = [
    "Metro 25–44 Homeowners",
    "Tier-2 Cities 28–50",
    "In-market: Air Conditioners",
    "Lookalike 1% Buyers",
    "Retargeting 30d",
    "Broad India 22–55",
  ];

  const ADS: RawAdSetDef[] = [];
  CAMP.forEach((c) => {
    if (c.id === 4 || c.nm) return;
    const n = c.id % 2 ? 3 : 4;
    const w = Array.from({ length: n }, () => 0.5 + rnd());
    const t = w.reduce((a, b) => a + b);
    const acc = {
      impr: 0,
      clicks: 0,
      spend: 0,
      pImpr: 0,
      pClicks: 0,
      pSpend: 0,
    };
    w.forEach((x, j) => {
      const a: RawAdSetDef = {
        id: `${c.id}-${j + 1}`,
        cid: c.id,
        name: `AS${j + 1}_${AUD[(c.id + j) % 6].split(" ")[0]}`,
        aud: AUD[(c.id + j) % 6],
        status:
          c.status === "Active" && j === n - 1 && c.id % 3 === 0
            ? "Paused"
            : c.status,
        q: c.q,
        impr: 0,
        clicks: 0,
        spend: 0,
        pImpr: 0,
        pClicks: 0,
        pSpend: 0,
      };
      (
        ["impr", "clicks", "spend", "pImpr", "pClicks", "pSpend"] as const
      ).forEach((k) => {
        a[k] =
          j < n - 1 ? Math.round((c[k] * x) / t) : c[k] - acc[k];
        acc[k] += a[k];
      });
      ADS.push(a);
    });
  });

  // Campaign 0 ad sets exact distribution
  {
    const c = CAMP[0];
    const a = ADS.filter((x) => x.cid === 0);
    const sh = [0.34, 0.26, 0.22, 0.18];
    const sp = (tot: number, j: number) =>
      j < 3
        ? Math.round(tot * sh[j])
        : tot - [0, 1, 2].reduce((q, i) => q + Math.round(tot * sh[i]), 0);
    const dr = [0.85, 0, 0.8, 0.75];

    a.forEach((x, j) => {
      x.status = "Active";
      x.name = [
        "AS1 — Broad Audience",
        "AS2 — Tier 2 Cities",
        "AS3 — Lookalike",
        "AS4 — Retargeting",
      ][j];
      x.aud = [
        "Broad India 22–55",
        "Tier-2 Cities 28–50",
        "Lookalike 1% Buyers",
        "Retargeting 30d",
      ][j];
      x.impr = sp(c.impr, j);
      x.pImpr = sp(c.pImpr, j);
      x.spend = sp(c.spend, j);
      x.pSpend = sp(c.pSpend, j);
      x.pClicks = sp(c.pClicks, j);
      x.clicks = j === 1 ? 0 : Math.round(x.pClicks * dr[j]);
    });
    a[1].clicks = c.clicks - a.reduce((q, x) => q + x.clicks, 0);
  }

  // Reach, engagements, conversions, revenue
  CAMP.forEach((c) => {
    if (c.nm) return;
    const f = 1.4 + rnd() * 1.2;
    const e0 = c.obj === "Engagement" ? 0.055 : 0.012;
    const cr = ({ Leads: 0.07, 'App Promotion': 0.09, Sales: 0.0009 } as Record<string, number | undefined>)[c.obj];

    c.reach = Math.round(c.impr / f);
    c.pReach = Math.round(c.pImpr / (f * (0.95 + rnd() * 0.1)));
    c.eng = Math.round(c.impr * e0 * (0.8 + rnd() * 0.4));
    c.pEng = Math.round(c.pImpr * e0 * (0.9 + rnd() * 0.2));

    if (cr) {
      c.conv = Math.max(1, Math.round(c.clicks * cr * (0.8 + rnd() * 0.4)));
      c.pConv = Math.max(1, Math.round(c.pClicks * cr * (0.8 + rnd() * 0.4)));
      if (c.obj === "Sales") {
        const av = 34000 + rnd() * 14000;
        c.rev = Math.round(c.conv * av);
        c.pRev = Math.round(c.pConv * av * (0.95 + rnd() * 0.1));
      }
    }
  });

  // Distribute to ad sets
  (
    [
      "reach",
      "pReach",
      "eng",
      "pEng",
      "conv",
      "pConv",
      "rev",
      "pRev",
    ] as const
  ).forEach((k) => {
    CAMP.forEach((c) => {
      if (c[k] == null) return;
      const a = ADS.filter((x) => x.cid === c.id);
      if (!a.length) return;
      let u = 0;
      a.forEach((x, j) => {
        const ratio = (x.impr || 1) / (c.impr || 1);
        x[k] =
          j < a.length - 1
            ? Math.round(c[k]! * ratio)
            : c[k]! - u;
        u += x[k]!;
      });
    });
  });

  return { CAMP, ADS };
}
