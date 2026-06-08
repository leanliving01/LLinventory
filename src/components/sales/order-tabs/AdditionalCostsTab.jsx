import React from 'react';
import AdditionalCostsCard from '../order-shared/AdditionalCostsCard';

export default function AdditionalCostsTab({ order, costs = [] }) {
  return <AdditionalCostsCard order={order} costs={costs} />;
}
