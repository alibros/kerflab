import './app/ui/base.css';
import { initTheme } from './app/ui/theme';
import { mountApp } from './app/main';

initTheme();

const app = document.querySelector<HTMLDivElement>('#app');
if (app) mountApp(app);
