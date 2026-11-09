/** Tugma bosilgan nuqtadan to'lqin (WinPro tugmalaridagi effekt). Uslubi: index.css `.ripple` */
export function addRippleEffect(e: React.MouseEvent<HTMLButtonElement>) {
  const button = e.currentTarget;
  const circle = document.createElement('span');
  const diameter = Math.max(button.clientWidth, button.clientHeight);
  const radius = diameter / 2;
  const rect = button.getBoundingClientRect();

  circle.style.width = circle.style.height = `${diameter}px`;
  circle.style.left = `${e.clientX - rect.left - radius}px`;
  circle.style.top = `${e.clientY - rect.top - radius}px`;
  circle.classList.add('ripple');

  button.getElementsByClassName('ripple')[0]?.remove();
  button.appendChild(circle);
}
