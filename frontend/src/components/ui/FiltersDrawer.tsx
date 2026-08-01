import React from 'react';
import { SlidersHorizontal, FilterX } from 'lucide-react';
import { Drawer } from './Drawer';
import { Button } from './Button';

interface FiltersDrawerProps {
  open: boolean;
  onClose: () => void;
  onApply: () => void;
  onClear: () => void;
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  applyLabel?: string;
  clearLabel?: string;
}

export function FiltersDrawer({
  open,
  onClose,
  onApply,
  onClear,
  children,
  title = 'Filtros',
  subtitle,
  applyLabel = 'Aplicar filtros',
  clearLabel = 'Limpar',
}: FiltersDrawerProps) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      icon={<SlidersHorizontal size={16} />}
      footer={
        <>
          <Button variant="outline" size="md" icon={<FilterX size={14} />} onClick={onClear}>
            {clearLabel}
          </Button>
          <Button variant="primary" size="md" onClick={onApply} className="flex-1">
            {applyLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4">{children}</div>
    </Drawer>
  );
}
