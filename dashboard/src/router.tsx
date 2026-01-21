import { createBrowserRouter } from 'react-router-dom';
import { Shell } from '@/components/layout/Shell';
import Dashboard from '@/pages/Dashboard';
import Sessions from '@/pages/Sessions';
import SessionDetail from '@/pages/SessionDetail';
import Alerts from '@/pages/Alerts';
import Policies from '@/pages/Policies';
import Graph from '@/pages/Graph';
import Analytics from '@/pages/Analytics';
import LiveFeed from '@/pages/LiveFeed';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Shell />,
    children: [
      {
        index: true,
        element: <Dashboard />,
      },
      {
        path: 'sessions',
        element: <Sessions />,
      },
      {
        path: 'sessions/:id',
        element: <SessionDetail />,
      },
      {
        path: 'alerts',
        element: <Alerts />,
      },
      {
        path: 'policies',
        element: <Policies />,
      },
      {
        path: 'graph',
        element: <Graph />,
      },
      {
        path: 'analytics',
        element: <Analytics />,
      },
      {
        path: 'live',
        element: <LiveFeed />,
      },
    ],
  },
]);
