import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { EmptyState } from '../components/ui/index.js';

export default function NotFoundPage() {
  return (
    <EmptyState
      icon={Compass}
      title="Page not found"
      description="The page you are looking for does not exist."
      action={
        <Link to="/dashboard" className="text-sm font-medium text-brand-600 hover:underline">
          Go to dashboard
        </Link>
      }
    />
  );
}
