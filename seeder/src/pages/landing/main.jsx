import { resolveLegacyRedirect } from '../../shared/legacy';
import { mountPage } from '../../shared/boot';
import page from './page';

// Pre-1.0 share links point at /?seed=…: send them to the seed page before anything
// renders. The inline script in index.html already hid the body for this.
const target = resolveLegacyRedirect(window.location.search);
if (target) {
    window.location.replace(target);
} else {
    // The inline script only hides the body for a decimal ?seed=, the same test as
    // resolveLegacyRedirect; clearing the class again keeps the landing visible whatever it decided.
    document.documentElement.classList.remove('redirecting');
    mountPage(page(), { hydrate: true });
}
