import React from 'react';
import ReturnsBlock from '../order-shared/ReturnsBlock';

export default function ReturnsTab({ returns = [] }) {
  return <ReturnsBlock returns={returns} />;
}
