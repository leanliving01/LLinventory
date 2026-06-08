// Shared money formatter for sales order detail views — matches the row's R#,###.## style.
export const money = (n) =>
  `R${(Number(n) || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const rand = () => (crypto?.randomUUID ? crypto.randomUUID() : String(Math.random()));
