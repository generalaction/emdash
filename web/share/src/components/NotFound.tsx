import { BrandBar } from './SharePage';

export function NotFound() {
  return (
    <>
      <BrandBar />
      <main>
        <section className="not-found">
          <p className="eyebrow">Emdash</p>
          <h1>Share not found</h1>
          <p className="description">This link may have been revoked or typed incorrectly.</p>
          <a className="cta-pill not-found-cta" href="https://emdash.sh">
            Download Emdash
          </a>
        </section>
      </main>
    </>
  );
}
