import Layout from '../../shared/Layout';
import Landing from './Landing';

// The landing's whole tree, shared by main.jsx (hydration) and the prerender.
export default function page() {
    return <Layout variant="page" path="/"><Landing /></Layout>;
}
