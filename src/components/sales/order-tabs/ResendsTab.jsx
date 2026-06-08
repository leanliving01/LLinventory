import React from 'react';
import ResendsBlock from '../order-shared/ResendsBlock';

export default function ResendsTab({ order, resends = [] }) {
  return <ResendsBlock order={order} resends={resends} />;
}
