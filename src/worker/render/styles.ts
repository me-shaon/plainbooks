// Document CSS. Static text only: the accent color and font come in as CSS variables from
// `themeCss`, after validation. Public pages load this file from /p/assets/document.css.
// PDF HTML inlines it.

export const DOCUMENT_CSS_PATH = "/p/assets/document.css";

export const DOCUMENT_CSS = `
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{margin:0;background:#f1f0ec;color:#1b1b19;font-family:var(--font);font-size:14px;line-height:1.45;font-feature-settings:"kern"}
.mono,.num{font-family:var(--mono);font-variant-numeric:tabular-nums}
.num{text-align:right;white-space:nowrap}
.muted{color:#66635c}
.pre{white-space:pre-line}
.flush{margin:0}
.label{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#66635c;font-weight:500}
.shell{max-width:842px;margin:0 auto;padding:32px 24px 56px;display:flex;flex-direction:column;gap:16px}
.toolbar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px}
.toolbar .who{font-size:13px;color:#66635c}
.button{display:inline-flex;align-items:center;justify-content:center;min-height:40px;padding:0 16px;border-radius:8px;border:1px solid #1b1b19;background:#1b1b19;color:#fff;font:inherit;font-weight:500;font-size:14px;text-decoration:none;cursor:pointer}
.button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.button.secondary{background:#fff;color:#1b1b19;border-color:#c9c6bd}
.banners{display:flex;flex-direction:column;gap:8px}
.banner{border-radius:8px;padding:12px 16px;border:1px solid #dcd9d0;background:#fff;display:flex;flex-direction:column;gap:2px}
.banner strong{font-weight:600}
.banner.danger{background:#fbeceb;border-color:#e7b9b5;color:#7a1f17}
.banner.success{background:#e8f3ee;border-color:#b5d6c6;color:#1d5a40}
.banner.warning{background:#fcf3e3;border-color:#ecd3a3;color:#6d4a0c}
.banner .comment{white-space:pre-line;color:inherit;opacity:.9}
.page{background:#fff;color:#1b1b19;border-radius:6px;padding:48px 52px;box-shadow:0 1px 2px rgb(0 0 0/.06),0 12px 32px rgb(0 0 0/.08);display:flex;flex-direction:column;gap:30px;position:relative;overflow:hidden}
.void-mark{position:absolute;top:38%;left:50%;transform:translate(-50%,-50%) rotate(-18deg);font-size:120px;font-weight:600;letter-spacing:.08em;color:rgb(180 35 24/.1);pointer-events:none;user-select:none}
.sec{display:flex;flex-direction:column;gap:6px}
.fields{display:grid;grid-template-columns:auto 1fr;gap:2px 14px;margin:6px 0 0;font-size:12px}
.fields dt{color:#66635c}
.fields dd{margin:0;color:#1b1b19}
.header{display:flex;flex-direction:row;flex-wrap:wrap;justify-content:space-between;align-items:flex-start;gap:20px}
.brand{display:flex;flex-direction:column;gap:4px;min-width:0}
.logo{max-width:180px;max-height:64px;object-fit:contain;object-position:left;align-self:flex-start;margin-bottom:6px}
.business{font-weight:600;font-size:15px}
.small{font-size:12px}
.title-block{display:flex;flex-direction:column;gap:4px;text-align:right}
.title{font-size:28px;font-weight:600;letter-spacing:-.02em;line-height:1.1}
.title-block .fields{justify-content:end}
.bill-name{font-weight:500;font-size:15px}
.items{width:100%;border-collapse:collapse;font-size:13px}
.items th{text-align:left;font-size:11px;color:#66635c;letter-spacing:.04em;text-transform:uppercase;font-weight:500;padding:0 0 10px;border-bottom:1px solid #1b1b19}
.items th.num{text-align:right}
.items td{padding:12px 0;border-bottom:1px solid #ecebe6;vertical-align:top}
.items th+th,.items td+td{padding-left:16px}
.items .desc{white-space:pre-line;overflow-wrap:anywhere}
.items .tax-name{display:block;font-size:11px;color:#66635c}
.totals{display:grid;grid-template-columns:auto auto;gap:6px 0;font-size:13px;align-self:flex-end;min-width:260px}
.totals dt{color:#66635c}
.totals dd{margin:0;padding-left:28px;text-align:right;font-family:var(--mono);font-variant-numeric:tabular-nums;white-space:nowrap}
.totals .grand{font-weight:600;color:#1b1b19;padding-top:8px;border-top:1px solid #1b1b19}
.totals .balance{font-weight:600;color:#1b1b19}
.totals-wrap{display:flex;flex-direction:column;gap:8px}
.totals-wrap .fields,.totals-wrap .tax-notes{align-self:flex-end}
.tax-notes{font-size:12px;color:#66635c;margin:0;padding:0;list-style:none}
.fx-note{font-size:12px;color:#66635c;align-self:flex-end;text-align:right}
.pay{font-size:13px}
.pay .details{white-space:pre-line;color:#1b1b19}
.footer{font-size:12px;color:#66635c;border-top:1px solid #ecebe6;padding-top:16px}
.decision{background:#fff;border-radius:6px;padding:24px;border:1px solid #dcd9d0;display:flex;flex-direction:column;gap:12px}
.decision h2{margin:0;font-size:17px;font-weight:600}
.decision p{margin:0}
.decision label{font-weight:500;font-size:13px}
.decision textarea{width:100%;min-height:96px;border:1px solid #c9c6bd;border-radius:8px;padding:10px 12px;font:inherit;resize:vertical}
.decision textarea:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.decision .buttons{display:flex;flex-wrap:wrap;gap:8px}
.decision .error{color:#7a1f17;font-size:13px}
.not-found{max-width:420px;margin:15vh auto;padding:0 24px;text-align:center;color:#66635c}
.not-found h1{color:#1b1b19;font-size:22px;font-weight:600;margin:0 0 8px}

/* Minimal: light type, more space, totals on the left. */
.layout-minimal{gap:44px;padding:64px 64px}
.layout-minimal .title{font-size:13px;font-weight:500;letter-spacing:.18em;text-transform:uppercase;color:#66635c}
.layout-minimal .title-block .doc-number{font-size:20px;color:#1b1b19}
.layout-minimal .business{font-weight:500}
.layout-minimal .items th{border-bottom-color:#dcd9d0;font-weight:400}
.layout-minimal .items td{border-bottom-color:#f1f0ec;padding:14px 0}
.layout-minimal .totals,.layout-minimal .totals-wrap .fields,.layout-minimal .totals-wrap .tax-notes,.layout-minimal .fx-note{align-self:flex-start;text-align:left}
.layout-minimal .totals .grand{border-top-color:#dcd9d0;font-weight:500}
.layout-minimal .footer{border-top:0;padding-top:0}

/* Bold: an accent band across the top and a large total. */
.layout-bold{padding-top:0}
.layout-bold.band-off{padding-top:48px}
.layout-bold .header{background:var(--accent);color:var(--on-accent);margin:0 -52px;padding:36px 52px 32px}
.layout-bold .header .muted,.layout-bold .header .fields dt,.layout-bold .header .fields dd{color:var(--on-accent);opacity:.85}
.layout-bold .title{font-size:34px}
.layout-bold .items th{border-bottom:2px solid var(--accent)}
.layout-bold .totals .grand{border-top:0;margin-top:8px;padding:14px 0 14px 16px;background:var(--accent-soft);font-size:15px}
.layout-bold .totals dt.grand{display:flex;align-items:center}
.layout-bold .totals dd.grand{padding:14px 16px 14px 28px;font-size:24px;color:var(--accent-ink)}

@media (max-width:767px){
  .shell{padding:16px 12px 40px;gap:12px}
  .page,.layout-minimal{padding:24px 20px;gap:24px}
  .layout-bold{padding-top:0}
  .layout-bold .header{margin:0 -20px;padding:24px 20px}
  .header{flex-direction:column}
  .title-block{text-align:left}
  .title-block .fields{justify-content:start}
  .sec-header{order:-2}
  .sec-payment_details{order:-1;background:#f7f6f2;border-radius:6px;padding:12px 14px}
  .toolbar .button{flex:1 1 auto}
  .items thead{display:none}
  .items,.items tbody,.items tr,.items td{display:block;width:100%}
  .items tr{display:grid;grid-template-columns:1fr auto;gap:2px 12px;padding:12px 0;border-bottom:1px solid #ecebe6}
  .items td{border:0;padding:0}
  .items th+th,.items td+td{padding-left:0}
  .items td.desc{grid-column:1/-1;font-weight:500}
  .items td.num{grid-column:1;text-align:left;font-size:12px;color:#66635c}
  .items td.num::before{content:attr(data-label) " ";font-family:var(--font)}
  .items td.amount{grid-column:2;grid-row:2/span 3;text-align:right;align-self:end;font-size:13px;color:#1b1b19}
  .items td.amount::before{content:none}
  .totals,.totals-wrap .fields,.totals-wrap .tax-notes,.fx-note{align-self:stretch;min-width:0}
  .void-mark{font-size:72px}
}

@page{size:A4;margin:14mm 14mm 16mm}
@media print{
  body{background:#fff}
  .shell{max-width:none;padding:0}
  .toolbar,.decision,.no-print{display:none!important}
  .banner{break-inside:avoid}
  .page{box-shadow:none;border-radius:0;padding:0}
  .layout-bold .header{margin:0 0 4px;padding:28px 28px 24px;border-radius:4px}
  .items tr{break-inside:avoid}
  .totals-wrap,.sec-payment_details,.sec-footer{break-inside:avoid}
}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
`;
