import { render } from 'preact';
import { Popup } from './Popup';
import css from './styles.css';

const style = document.createElement('style');
style.textContent = css;
document.head.appendChild(style);
render(<Popup />, document.getElementById('app')!);
