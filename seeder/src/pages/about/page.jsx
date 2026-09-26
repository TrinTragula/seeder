import Layout from '../../shared/Layout';
import About from './About';

// The About page's whole tree, shared by main.jsx (hydration) and the prerender.
export default function page() {
    return <Layout variant="page" path="/about/"><About /></Layout>;
}
