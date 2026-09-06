import { Link } from 'react-router-dom';

export function NotFoundPage(): JSX.Element {
  return (
    <div className="text-center py-5">
      <h1 className="display-6">Page not found</h1>
      <p className="text-body-secondary">That route does not exist.</p>
      <Link className="btn btn-primary" to="/">
        Back to the dashboard
      </Link>
    </div>
  );
}
