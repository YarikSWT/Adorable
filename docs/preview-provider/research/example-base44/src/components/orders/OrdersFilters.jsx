import React from 'react';
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Filter, X } from "lucide-react";

export default function OrdersFilters({ filters, onFiltersChange, packages = [] }) {
  const activeFiltersCount = Object.entries(filters).filter(([key, value]) => {
    if (key === 'status') return false; // статус не считаем, он в табах
    if (key === 'baby_gender' || key === 'template_package_id') {
      return value !== 'all';
    }
    return value !== null && value !== '';
  }).length;

  const handleFilterChange = (key, value) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  const handleReset = () => {
    onFiltersChange({
      status: filters.status, // сохраняем статус из табов
      baby_gender: 'all',
      template_package_id: 'all',
      birth_date_from: null,
      birth_date_to: null,
      created_date_from: null,
      created_date_to: null,
    });
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="gap-2 relative">
          <Filter className="w-4 h-4" />
          Фильтры
          {activeFiltersCount > 0 && (
            <Badge 
              variant="secondary" 
              className="ml-1 px-1.5 py-0 text-xs bg-slate-900 text-white hover:bg-slate-800"
            >
              {activeFiltersCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="start">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-sm text-slate-900">Расширенные фильтры</h4>
            {activeFiltersCount > 0 && (
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={handleReset}
                className="h-auto p-0 text-xs text-slate-600 hover:text-slate-900"
              >
                <X className="w-3 h-3 mr-1" />
                Сбросить
              </Button>
            )}
          </div>

          {/* Пол ребёнка */}
          <div className="space-y-2">
            <Label className="text-xs text-slate-600">Пол ребёнка</Label>
            <Select 
              value={filters.baby_gender} 
              onValueChange={(v) => handleFilterChange('baby_gender', v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Все" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все</SelectItem>
                <SelectItem value="boy">Мальчик</SelectItem>
                <SelectItem value="girl">Девочка</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Пакет шаблонов */}
          <div className="space-y-2">
            <Label className="text-xs text-slate-600">Пакет шаблонов</Label>
            <Select 
              value={filters.template_package_id} 
              onValueChange={(v) => handleFilterChange('template_package_id', v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Все" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все</SelectItem>
                {packages.map(pkg => (
                  <SelectItem key={pkg.id} value={pkg.id}>
                    {pkg.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Дата рождения */}
          <div className="space-y-2">
            <Label className="text-xs text-slate-600">Дата рождения</Label>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Input
                  type="date"
                  placeholder="От"
                  value={filters.birth_date_from || ''}
                  onChange={(e) => handleFilterChange('birth_date_from', e.target.value || null)}
                  className="text-sm"
                />
              </div>
              <div>
                <Input
                  type="date"
                  placeholder="До"
                  value={filters.birth_date_to || ''}
                  onChange={(e) => handleFilterChange('birth_date_to', e.target.value || null)}
                  className="text-sm"
                />
              </div>
            </div>
          </div>

          {/* Дата создания заказа */}
          <div className="space-y-2">
            <Label className="text-xs text-slate-600">Дата создания</Label>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Input
                  type="date"
                  placeholder="От"
                  value={filters.created_date_from || ''}
                  onChange={(e) => handleFilterChange('created_date_from', e.target.value || null)}
                  className="text-sm"
                />
              </div>
              <div>
                <Input
                  type="date"
                  placeholder="До"
                  value={filters.created_date_to || ''}
                  onChange={(e) => handleFilterChange('created_date_to', e.target.value || null)}
                  className="text-sm"
                />
              </div>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
