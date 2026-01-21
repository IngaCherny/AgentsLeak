import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import TokenGate from './components/auth/TokenGate';

function App() {
  return (
    <TokenGate>
      <RouterProvider router={router} />
    </TokenGate>
  );
}

export default App;
