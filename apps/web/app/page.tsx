import { RecentLiveOpsLink } from "./recent-live-ops-link";

export default function Home() {
  return (
    <main className="home">
      <p className="pe-eyebrow">Municipal permit planning</p>
      <h1>PopEngine</h1>
      <p className="home__lede">
        Synthetic-data demo only — access-gated (AD-12). Translate NYC event rules into a clear
        intake, plan, and door-day ops surface.
      </p>
      <a className="intake__submit" href="/intake">
        Describe your event
      </a>
      <RecentLiveOpsLink />
    </main>
  );
}
