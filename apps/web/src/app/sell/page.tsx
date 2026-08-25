"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { authed, isSignedIn, onAuthChange, openSignIn, humanizeError } from "../../lib/session";
import { formatCents } from "../../lib/format";
import { SellerOnboarding } from "../../components/SellerOnboarding";
import { ConsignmentBoard } from "../../components/ConsignmentBoard";
import { CatalogImport } from "../../components/CatalogImport";
import { PhotoUpload } from "../../components/PhotoUpload";

interface AuctionRow {
  id: string; name: string; status: string;
  lots: { id: string; lotNumber: number; status: string; bullName: string | null }[];
}
interface Analytics {
  totalLots: number; soldLots: number; clearanceRateBps: number;
  gmvCents: string; realizationBps: number; buyerReach: number;
}
interface Profile {
  title: string | null; bio: string | null; quote: string | null; foundedYear: number | null;
}
interface Operation {
  id: string; name: string; location: string; description: string; acres: number | null; herdSize: number | null;
}

function dollarsToCents(s: string): string {
  const clean = s.trim().replace(/[$,]/g, "");
  if (!clean) return "0";
  const [d, c = ""] = clean.split(".");
  return (BigInt(d || "0") * 100n + BigInt((c + "00").slice(0, 2))).toString();
}

export default function Sell() {
  const [signedIn, setSignedIn] = useState(false);
  const [auctions, setAuctions] = useState<AuctionRow[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [operations, setOperations] = useState<Operation[]>([]);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const sync = () => void isSignedIn().then(setSignedIn);
    sync();
    return onAuthChange(sync);
  }, []);
  useEffect(() => { if (signedIn) void refresh(); }, [signedIn]);

  async function refresh() {
    try {
      const [a, an, ops, prof] = await Promise.all([
        authed<{ auctions: AuctionRow[] }>("/console/auctions"),
        authed<Analytics>("/console/analytics"),
        authed<{ operations: Operation[] }>("/console/operations"),
        authed<{ profile: Profile }>("/console/profile"),
      ]);
      setAuctions(a.auctions);
      setAnalytics(an);
      setOperations(ops.operations);
      setTitle(prof.profile.title ?? "");
      setBio(prof.profile.bio ?? "");
      setQuote(prof.profile.quote ?? "");
      setFounded(prof.profile.foundedYear ? String(prof.profile.foundedYear) : "");
    } catch (e) { setMsg(humanizeError(e)); }
  }

  // --- profile / story ---
  const [title, setTitle] = useState("");
  const [bio, setBio] = useState("");
  const [quote, setQuote] = useState("");
  const [founded, setFounded] = useState("");
  async function saveProfile() {
    try {
      await authed("/console/profile", { method: "PUT", body: JSON.stringify({
        title: title || undefined, bio: bio || undefined, quote: quote || undefined,
        foundedYear: founded ? Number(founded) : undefined,
      }) });
      setMsg("Profile saved — visible on your public seller page");
    } catch (e) { setMsg(humanizeError(e)); }
  }

  // --- operations ---
  const [opName, setOpName] = useState("");
  const [opLoc, setOpLoc] = useState("");
  const [opDesc, setOpDesc] = useState("");
  const [opAcres, setOpAcres] = useState("");
  const [opHerd, setOpHerd] = useState("");
  async function addOperation() {
    try {
      await authed("/console/operations", { method: "POST", body: JSON.stringify({
        name: opName, location: opLoc, description: opDesc,
        acres: opAcres ? Number(opAcres) : undefined, herdSize: opHerd ? Number(opHerd) : undefined,
      }) });
      setOpName(""); setOpLoc(""); setOpDesc(""); setOpAcres(""); setOpHerd("");
      setMsg("Operation added"); await refresh();
    } catch (e) { setMsg(humanizeError(e)); }
  }
  async function removeOperation(id: string) {
    try { await authed(`/console/operations/${id}`, { method: "DELETE" }); await refresh(); }
    catch (e) { setMsg(humanizeError(e)); }
  }

  // --- auctions / lots ---
  const [aName, setAName] = useState("");
  const [aStart, setAStart] = useState("");
  const [premium, setPremium] = useState("0");
  async function createAuction() {
    try {
      await authed("/console/auctions", { method: "POST", body: JSON.stringify({
        name: aName, startsAt: aStart ? new Date(aStart).toISOString() : new Date().toISOString(),
        buyerPremiumBps: Math.round(Number(premium) * 100),
        commissionCentsPerHead: commission ? Number(dollarsToCents(commission)) : undefined,
        yardageCentsPerHead: yardage ? Number(dollarsToCents(yardage)) : undefined,
        brandInspectionCentsPerHead: brandFee ? Number(dollarsToCents(brandFee)) : undefined,
      }) });
      setAName(""); setMsg("Auction created"); await refresh();
    } catch (e) { setMsg(humanizeError(e)); }
  }

  const [lotAuction, setLotAuction] = useState("");
  const [lotNo, setLotNo] = useState("1");
  const [lotCategory, setLotCategory] = useState("STEERS");
  const [headCount, setHeadCount] = useState("");
  const [avgWeight, setAvgWeight] = useState("");
  const [shrink, setShrink] = useState("3");
  const [breed, setBreed] = useState("");
  const [originState, setOriginState] = useState("");
  const [certs, setCerts] = useState("");
  const [commission, setCommission] = useState("15.00");
  const [yardage, setYardage] = useState("1.50");
  const [brandFee, setBrandFee] = useState("");
  const [bull, setBull] = useState("");
  const [doses, setDoses] = useState("");
  const [start, setStart] = useState("");
  const [photoCredit, setPhotoCredit] = useState("");
  const [photoKeys, setPhotoKeys] = useState<string[]>([]);
  const [epdText, setEpdText] = useState('{ "CED": 8, "BW": {"value": 1.2, "pct": 15}, "WW": 70, "Marb": {"value": 0.8, "pct": 4} }');
  /**
   * The unit a class actually trades in. Feeder and slaughter cattle are quoted
   * per hundredweight against their weight; breeding stock and pairs sell by
   * the head; genetics by the dose or embryo.
   */
  function priceUnitFor(category: string): string {
    if (category === "SEMEN") return "DOSE";
    if (category === "EMBRYO") return "EMBRYO";
    if (["BULLS", "PAIRS", "BRED_HEIFERS"].includes(category)) return "HEAD";
    return "CWT";
  }

  const isGenetics = lotCategory === "SEMEN" || lotCategory === "EMBRYO";

  async function addLot() {
    let epd: unknown;
    try { epd = epdText.trim() ? JSON.parse(epdText) : undefined; } catch { setMsg("Couldn't read those EPD values — check the format and try again."); return; }
    try {
      const res = await authed<{ epdWarnings: string[] }>(`/console/auctions/${lotAuction}/lots`, {
        method: "POST", body: JSON.stringify({
          lotNumber: Number(lotNo),
          category: lotCategory,
          priceUnit: priceUnitFor(lotCategory),
          startingBidCents: dollarsToCents(start),
          headCount: headCount ? Number(headCount) : undefined,
          avgWeightLbs: avgWeight ? Number(avgWeight) : undefined,
          shrinkPct: shrink ? Number(shrink) : undefined,
          primaryBreed: breed || undefined,
          originState: originState || undefined,
          programCerts: certs ? certs.split(",").map((c) => c.trim()).filter(Boolean) : undefined,
          bullName: bull || undefined,
          dosesAvailable: doses ? Number(doses) : undefined,
          photoCredit: photoCredit || undefined,
          photos: photoKeys.length ? photoKeys : undefined, epd,
        }),
      });
      setMsg(`Lot created${res.epdWarnings.length ? ` · EPD warnings: ${res.epdWarnings.join("; ")}` : ""}`);
      await refresh();
    } catch (e) { setMsg(humanizeError(e)); }
  }

  async function activate(lotId: string) {
    try { await authed(`/console/lots/${lotId}/status`, { method: "POST", body: JSON.stringify({ status: "ACTIVE" }) }); await refresh(); }
    catch (e) { setMsg(humanizeError(e)); }
  }

  if (!signedIn) {
    return (
      <main className="wrap section">
        <div className="signin-wrap">
          <div className="eyebrow">Seller Console</div>
          <h1>Run Your Own Sale</h1>
          <p className="muted">Sign in to build a sale, consign lots, and take the ring live.</p>
          <button className="btn btn-primary btn-lg" style={{ marginTop: 20, maxWidth: 220 }} onClick={openSignIn}>Sign In to Sell</button>
        </div>
      </main>
    );
  }

  const pct = (bps: number) => `${(bps / 100).toFixed(0)}%`;

  return (
    <main className="wrap section">
      <div className="eyebrow">Seller Console</div>
      <h1 style={{ fontSize: 34, margin: "10px 0 20px" }}>Your Sales</h1>

      {analytics && (
        <div className="dash-grid">
          <div className="tile"><div className="l">Clearance</div><div className="n tabular">{pct(analytics.clearanceRateBps)}</div></div>
          <div className="tile"><div className="l">GMV</div><div className="n tabular">{formatCents(analytics.gmvCents)}</div></div>
          <div className="tile"><div className="l">Realization</div><div className="n tabular">{pct(analytics.realizationBps)}</div></div>
          <div className="tile"><div className="l">Lots</div><div className="n tabular">{analytics.soldLots}/{analytics.totalLots}</div></div>
          <div className="tile"><div className="l">Buyer reach</div><div className="n tabular">{analytics.buyerReach}</div></div>
        </div>
      )}

      {msg && <div className="statusmsg info" style={{ marginBottom: 18 }}>{msg}</div>}

      <SellerOnboarding />

      <CatalogImport
        auctions={auctions.map((a) => ({ id: a.id, name: a.name }))}
        onImported={() => void refresh()}
      />

      <div className="card-form">
        <h2>Your Story</h2>
        <p className="block-note" style={{ marginTop: -10 }}>Shown on your public seller page — the &ldquo;behind the brand&rdquo; profile buyers see.</p>
        <div className="form-grid">
          <label className="field"><span className="label">Title / Role</span><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Owner & General Manager" /></label>
          <label className="field"><span className="label">Founded Year</span><input className="input" value={founded} onChange={(e) => setFounded(e.target.value)} placeholder="1987" /></label>
        </div>
        <label className="field" style={{ marginBottom: 14 }}><span className="label">Bio</span>
          <textarea className="input" rows={4} value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Two or three paragraphs on the program's history and philosophy…" style={{ fontFamily: "inherit" }} />
        </label>
        <label className="field" style={{ marginBottom: 16 }}><span className="label">Pull-Quote</span>
          <input className="input" value={quote} onChange={(e) => setQuote(e.target.value)} placeholder="A short, quotable line about how you run the program." />
        </label>
        <button className="btn btn-primary" onClick={saveProfile}>Save Story</button>
      </div>

      <div className="card-form">
        <h2>Operations</h2>
        <p className="block-note" style={{ marginTop: -10 }}>Your ranch properties or divisions — shown on your profile page.</p>
        {operations.length > 0 && (
          <ul className="lotlist" style={{ marginBottom: 16 }}>
            {operations.map((op) => (
              <li key={op.id}>
                <span><strong>{op.name}</strong> — {op.location}</span>
                <button className="btn-link" style={{ marginLeft: "auto", color: "var(--danger)" }} onClick={() => removeOperation(op.id)}>Remove</button>
              </li>
            ))}
          </ul>
        )}
        <div className="form-grid">
          <label className="field"><span className="label">Name</span><input className="input" value={opName} onChange={(e) => setOpName(e.target.value)} placeholder="Home Place" /></label>
          <label className="field"><span className="label">Location</span><input className="input" value={opLoc} onChange={(e) => setOpLoc(e.target.value)} placeholder="Big Timber, Montana" /></label>
          <label className="field"><span className="label">Acres</span><input className="input" value={opAcres} onChange={(e) => setOpAcres(e.target.value)} /></label>
          <label className="field"><span className="label">Herd Size</span><input className="input" value={opHerd} onChange={(e) => setOpHerd(e.target.value)} /></label>
        </div>
        <label className="field" style={{ marginBottom: 16 }}><span className="label">Description</span>
          <input className="input" value={opDesc} onChange={(e) => setOpDesc(e.target.value)} placeholder="What happens on this property" />
        </label>
        <button className="btn btn-primary" onClick={addOperation} disabled={!opName || !opLoc || !opDesc}>Add Operation</button>
      </div>

      <div className="card-form">
        <h2>New Sale</h2>
        <p className="block-note" style={{ marginTop: -10 }}>
          Commission, yardage, and brand inspection come out of the seller&rsquo;s proceeds. The
          buyer&rsquo;s premium sits on top of the hammer. The federal $1/head Beef Checkoff is
          applied automatically to cattle lots.
        </p>
        <div className="form-grid">
          <label className="field"><span className="label">Sale Name</span><input className="input" value={aName} onChange={(e) => setAName(e.target.value)} placeholder="Spring Genetics Sale" /></label>
          <label className="field"><span className="label">Starts</span><input className="input" type="datetime-local" value={aStart} onChange={(e) => setAStart(e.target.value)} /></label>
          <label className="field"><span className="label">Buyer Premium %</span><input className="input" value={premium} onChange={(e) => setPremium(e.target.value)} /></label>
          <label className="field"><span className="label">Commission $/Head</span><input className="input" value={commission} onChange={(e) => setCommission(e.target.value)} placeholder="15.00" /></label>
          <label className="field"><span className="label">Yardage $/Head</span><input className="input" value={yardage} onChange={(e) => setYardage(e.target.value)} placeholder="1.50" /></label>
          <label className="field"><span className="label">Brand Inspection $/Head</span><input className="input" value={brandFee} onChange={(e) => setBrandFee(e.target.value)} placeholder="0.75" /></label>
        </div>
        <button className="btn btn-primary" onClick={createAuction} disabled={!aName}>Create Auction</button>
      </div>

      <div className="card-form">
        <h2>Add Lot</h2>
        <div className="form-grid">
          <label className="field"><span className="label">Auction</span>
            <select className="input" value={lotAuction} onChange={(e) => setLotAuction(e.target.value)}>
              <option value="">Select a sale…</option>
              {auctions.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <label className="field"><span className="label">Lot #</span><input className="input" value={lotNo} onChange={(e) => setLotNo(e.target.value)} /></label>
          <label className="field"><span className="label">Class</span>
            <select className="input" value={lotCategory} onChange={(e) => setLotCategory(e.target.value)}>
              <option value="STEERS">Steers</option>
              <option value="HEIFERS">Heifers</option>
              <option value="CALVES">Calves</option>
              <option value="COWS">Cows</option>
              <option value="PAIRS">Pairs</option>
              <option value="BRED_HEIFERS">Bred Heifers</option>
              <option value="BULLS">Bulls</option>
              <option value="SEMEN">Semen</option>
              <option value="EMBRYO">Embryo</option>
            </select>
            <span className="dim" style={{ fontSize: 12 }}>Priced per {priceUnitFor(lotCategory).toLowerCase()}</span>
          </label>
          {!isGenetics && (
            <>
              <label className="field"><span className="label">Head Count</span><input className="input" value={headCount} onChange={(e) => setHeadCount(e.target.value)} placeholder="300" /></label>
              <label className="field"><span className="label">Avg Weight (lb)</span><input className="input" value={avgWeight} onChange={(e) => setAvgWeight(e.target.value)} placeholder="575" /></label>
              <label className="field"><span className="label">Pencil Shrink %</span><input className="input" value={shrink} onChange={(e) => setShrink(e.target.value)} placeholder="3" /></label>
              <label className="field"><span className="label">Breed / Type</span><input className="input" value={breed} onChange={(e) => setBreed(e.target.value)} placeholder="Black Angus cross" /></label>
              <label className="field"><span className="label">Origin State</span><input className="input" value={originState} onChange={(e) => setOriginState(e.target.value)} placeholder="KS" /></label>
              <label className="field"><span className="label">Programs</span><input className="input" value={certs} onChange={(e) => setCerts(e.target.value)} placeholder="VAC-45, BQA" /></label>
            </>
          )}
          <label className="field"><span className="label">Bull Name</span><input className="input" value={bull} onChange={(e) => setBull(e.target.value)} /></label>
          <label className="field"><span className="label">Doses</span><input className="input" value={doses} onChange={(e) => setDoses(e.target.value)} /></label>
          <label className="field"><span className="label">Opening Bid $</span><input className="input" value={start} onChange={(e) => setStart(e.target.value)} placeholder="25.00" /></label>
          <label className="field"><span className="label">Photo Credit</span><input className="input" value={photoCredit} onChange={(e) => setPhotoCredit(e.target.value)} placeholder="Photo: Jane Smith" /></label>
          <PhotoUpload onUploaded={setPhotoKeys} />
        </div>
        <label className="field" style={{ marginBottom: 16 }}><span className="label">EPDs (JSON)</span>
          <textarea className="input" rows={3} value={epdText} onChange={(e) => setEpdText(e.target.value)} />
        </label>
        <button className="btn btn-primary" onClick={addLot} disabled={!lotAuction}>Add Lot</button>
      </div>

      <h2 style={{ fontSize: 22, margin: "8px 0 14px" }}>Sales</h2>
      {auctions.length === 0 ? <p className="dim">No sales yet — create one above.</p> : auctions.map((a) => (
        <div key={a.id} className="auction-row">
          <div className="head">
            <strong style={{ fontFamily: "var(--font-display)", fontSize: 18 }}>{a.name}</strong>
            <span className={`pill ${a.status.toLowerCase()}`}>{a.status}</span>
            {a.status !== "CLOSED" && <Link href={`/ring/${a.id}`} className="btn-link" style={{ marginLeft: "auto" }}>Open Ring →</Link>}
          </div>
          <ul className="lotlist">
            {a.lots.map((l) => (
              <li key={l.id}>
                <span>Lot {l.lotNumber}</span>
                <span className="muted">{l.bullName ?? "—"}</span>
                <span className={`pill ${l.status.toLowerCase()}`} style={{ marginLeft: "auto" }}>{l.status}</span>
                {l.status === "DRAFT" && <button className="btn btn-ghost btn-sm" onClick={() => activate(l.id)}>Activate</button>}
              </li>
            ))}
            {a.lots.length === 0 && <li className="dim">No lots yet</li>}
          </ul>
          <ConsignmentBoard auctionId={a.id} />
        </div>
      ))}
    </main>
  );
}
