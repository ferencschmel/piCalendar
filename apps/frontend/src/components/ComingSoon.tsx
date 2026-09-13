/**
 * The placeholder behind a navigation entry whose page is not built yet.
 *
 * It says so plainly rather than showing an empty shell: the display is
 * unattended, and a blank page is indistinguishable from one that failed to
 * load.
 */
export function ComingSoon({
  title,
  icon,
  description,
}: {
  title: string;
  /** Bootstrap icon name, without the `bi-` prefix. */
  icon: string;
  /** What this page will eventually do, so the entry is not a mystery. */
  description: string;
}): JSX.Element {
  return (
    <div className="coming-soon">
      <i className={`bi bi-${icon} coming-soon__icon`} aria-hidden="true" />
      <h1 className="h2">{title}</h1>
      <p className="text-body-secondary coming-soon__description">{description}</p>
      <span className="badge text-bg-secondary">
        <i className="bi bi-hourglass-split me-1" aria-hidden="true" />
        Coming soon
      </span>
    </div>
  );
}
