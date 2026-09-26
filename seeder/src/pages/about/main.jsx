import { mountPage } from '../../shared/boot';
import page from './page';

mountPage(page(), { hydrate: true });
