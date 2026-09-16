import { useState } from "react";
import { Navigate } from "react-router";
import { type scenarios, scenarioPath } from "./state";
import { categories, screenHref, screens, type PreviewScreen } from "./catalog";

export function Launcher({ scenario, screen }: { scenario?: typeof scenarios[number]; screen?: PreviewScreen }) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  if (screen) return <Navigate replace to={screen.path} />;
  if (scenario) return <Navigate replace to={scenarioPath(scenario[0])} />;
  const query = search.trim().toLowerCase();
  const visible = categories.filter(group => category === "all" || category === group.id).map(group => ({ ...group,
    screens: group.screens.filter(item => `${group.title} ${item.title} ${item.description}`.toLowerCase().includes(query)),
  })).filter(group => group.screens.length);
  const count = visible.reduce((total, group) => total + group.screens.length, 0);
  return <main className="preview-launcher">
    <header><span className="preview-eyebrow">VENFOUR · LOCAL PREVIEW</span><h1>Every screen, in one place.</h1>
      <p>Explore the customer, admin, and business experiences with fictional data. Choose a screen to open it directly.</p>
      <p className="preview-disclosure">Fictional data only. No messages or payments are sent. Customer tiles open saved examples; admin and business previews preserve local edits.</p>
    </header>
    <div className="preview-filters">
      <label htmlFor="screen-search">Find a screen<input id="screen-search" type="search" placeholder="Search screens…" value={search} onChange={event => setSearch(event.target.value)} /></label>
      <label htmlFor="screen-category">Category<select id="screen-category" value={category} onChange={event => setCategory(event.target.value)}>
        <option value="all">All categories</option>{categories.map(group => <option key={group.id} value={group.id}>{group.title}</option>)}
      </select></label>
    </div>
    <p className="preview-count" role="status">{count} of {screens.length} screens · {visible.length} {visible.length === 1 ? "category" : "categories"}</p>
    {visible.map(group => <section className="preview-category" key={group.id} aria-labelledby={`category-${group.id}`}>
      <div className="preview-category-heading"><h2 id={`category-${group.id}`}>{group.title}</h2><span>{group.screens.length} screens</span></div>
      <p>{group.description}</p>
      <nav aria-label={`${group.title} screens`}>{group.screens.map(item => <a key={item.id} href={screenHref(item)}><strong>{item.title}</strong><span>{item.description}</span></a>)}</nav>
    </section>)}
    {!count && <div className="preview-empty"><h2>No matching screens</h2><p>Try another search or category.</p><button type="button" onClick={() => { setSearch(""); setCategory("all"); }}>Show all screens</button></div>}
  </main>;
}
