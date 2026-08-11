import { ThemeToggle } from "./_components/theme-toggle";

export default function Home() {
  return (
    <main className="home riso-cover">
      <header className="riso-cover__header">
        <a className="riso-cover__mark" href="/">
          PE
        </a>
        <div className="riso-cover__controls">
          <ThemeToggle />
          <a href="/auth">Sign in</a>
        </div>
      </header>

      <section className="riso-cover__hero">
        <p className="riso-cover__edition">NYC event organizer field guide</p>
        <h1>PopEngine</h1>
        <p className="home__lede">
          One event record for permit planning, promotion, and door-day operations—with regulatory
          decisions and their sources kept together.
        </p>
        <a className="button button--primary" href="/intake">
          Describe your event
        </a>
      </section>

      <ol className="riso-cover__lifecycle" aria-label="Event lifecycle">
        <li>
          <span>01</span>
          <strong>Ideate</strong>
          <small>Describe the event once.</small>
        </li>
        <li>
          <span>02</span>
          <strong>Comply</strong>
          <small>Read the verdict with its sources.</small>
        </li>
        <li>
          <span>03</span>
          <strong>Market</strong>
          <small>Prepare the public event surface.</small>
        </li>
        <li>
          <span>04</span>
          <strong>Operate</strong>
          <small>Carry the record into event day.</small>
        </li>
      </ol>

      <footer className="riso-cover__footer">
        <p>Synthetic-data demo</p>
        <p>Additional lifecycle modules are labeled Planned inside the workspace.</p>
      </footer>
    </main>
  );
}
