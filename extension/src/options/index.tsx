import { render } from 'preact';
import { Options } from './Options';
import css from './styles.css';

const style = document.createElement('style');
style.textContent = css;
document.head.appendChild(style);
render(<Options />, document.getElementById('app')!);
