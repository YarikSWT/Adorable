import React, { useState, useMemo, useEffect } from 'react';
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious, PaginationEllipsis } from "@/components/ui/pagination";
import { Plus, Search, Filter, LayoutGrid, List } from "lucide-react";
import OrderCard from "../components/orders/OrderCard";
import OrdersTable from "../components/orders/OrdersTable";
import OrdersFilters from "../components/orders/OrdersFilters";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function OrdersPage() {
  // Загрузка настроек из localStorage
  const [viewMode, setViewMode] = useState(() => {
    return localStorage.getItem('ordersViewMode') || 'list';
  });
  const [sortConfig, setSortConfig] = useState(() => {
    const saved = localStorage.getItem('ordersSortConfig');
    return saved ? JSON.parse(saved) : { field: 'created_date', direction: 'desc' };
  });
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(() => {
    const saved = localStorage.getItem('ordersItemsPerPage');
    return saved ? parseInt(saved) : 12;
  });
  
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState({
    status: 'all',
    baby_gender: 'all',
    template_package_id: 'all',
    birth_date_from: null,
    birth_date_to: null,
    created_date_from: null,
    created_date_to: null,
  });

  // Сохранение настроек в localStorage
  useEffect(() => {
    localStorage.setItem('ordersViewMode', viewMode);
  }, [viewMode]);

  useEffect(() => {
    localStorage.setItem('ordersSortConfig', JSON.stringify(sortConfig));
  }, [sortConfig]);

  useEffect(() => {
    localStorage.setItem('ordersItemsPerPage', itemsPerPage.toString());
  }, [itemsPerPage]);

  // Загрузка заказов
  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['orders'],
    queryFn: () => base44.entities.Order.list('-created_date'),
  });

  // Загрузка пакетов для фильтра
  const { data: packages = [] } = useQuery({
    queryKey: ['packages'],
    queryFn: () => base44.entities.TemplatePackage.list(),
  });

  // Фильтрация заказов
  const filteredOrders = useMemo(() => {
    return orders.filter(order => {
      // Статус
      const matchesStatus = filters.status === 'all' || order.status === filters.status;
      
      // Поиск
      const matchesSearch = !searchQuery || 
        order.order_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        order.mother_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        order.baby_name?.toLowerCase().includes(searchQuery.toLowerCase());
      
      // Пол ребёнка
      const matchesGender = filters.baby_gender === 'all' || order.baby_gender === filters.baby_gender;
      
      // Пакет шаблонов
      const matchesPackage = filters.template_package_id === 'all' || order.template_package_id === filters.template_package_id;
      
      // Дата рождения
      let matchesBirthDate = true;
      if (filters.birth_date_from && order.birth_date) {
        matchesBirthDate = matchesBirthDate && new Date(order.birth_date) >= new Date(filters.birth_date_from);
      }
      if (filters.birth_date_to && order.birth_date) {
        matchesBirthDate = matchesBirthDate && new Date(order.birth_date) <= new Date(filters.birth_date_to);
      }
      
      // Дата создания
      let matchesCreatedDate = true;
      if (filters.created_date_from && order.created_date) {
        matchesCreatedDate = matchesCreatedDate && new Date(order.created_date) >= new Date(filters.created_date_from);
      }
      if (filters.created_date_to && order.created_date) {
        matchesCreatedDate = matchesCreatedDate && new Date(order.created_date) <= new Date(filters.created_date_to);
      }
      
      return matchesStatus && matchesSearch && matchesGender && matchesPackage && matchesBirthDate && matchesCreatedDate;
    });
  }, [orders, filters, searchQuery]);

  // Сортировка заказов
  const sortedOrders = useMemo(() => {
    const sorted = [...filteredOrders];
    
    sorted.sort((a, b) => {
      let aValue = a[sortConfig.field];
      let bValue = b[sortConfig.field];
      
      // Обработка null/undefined
      if (!aValue && !bValue) return 0;
      if (!aValue) return 1;
      if (!bValue) return -1;
      
      // Сортировка по статусу (по приоритету)
      if (sortConfig.field === 'status') {
        const statusPriority = { draft: 1, pending: 2, processing: 3, review: 4, completed: 5, archived: 6 };
        aValue = statusPriority[aValue] || 0;
        bValue = statusPriority[bValue] || 0;
      }
      
      // Сортировка по дате
      if (sortConfig.field === 'birth_date' || sortConfig.field === 'created_date') {
        aValue = new Date(aValue).getTime();
        bValue = new Date(bValue).getTime();
      }
      
      // Сортировка строк
      if (typeof aValue === 'string') {
        aValue = aValue.toLowerCase();
        bValue = bValue.toLowerCase();
      }
      
      if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
    
    return sorted;
  }, [filteredOrders, sortConfig]);

  // Пагинация
  const paginatedOrders = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return sortedOrders.slice(startIndex, startIndex + itemsPerPage);
  }, [sortedOrders, currentPage, itemsPerPage]);

  const totalPages = Math.ceil(sortedOrders.length / itemsPerPage);

  // Сброс страницы при изменении фильтров
  useEffect(() => {
    setCurrentPage(1);
  }, [filters, searchQuery, sortConfig]);

  const statusCounts = useMemo(() => ({
    all: orders.length,
    draft: orders.filter(o => o.status === 'draft').length,
    pending: orders.filter(o => o.status === 'pending').length,
    processing: orders.filter(o => o.status === 'processing').length,
    review: orders.filter(o => o.status === 'review').length,
    completed: orders.filter(o => o.status === 'completed').length,
  }), [orders]);

  // Обработчики
  const handleStatusChange = (status) => {
    setFilters({ ...filters, status });
  };

  const handleSort = (field) => {
    setSortConfig(prev => ({
      field,
      direction: prev.field === field && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const handleSortSelectChange = (value) => {
    const [field, direction] = value.split('-');
    setSortConfig({ field, direction });
  };

  const getCurrentSortValue = () => {
    return `${sortConfig.field}-${sortConfig.direction}`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 mb-2">
              Заказы
            </h1>
            <p className="text-slate-600">
              Управление заказами на генерацию newborn фотосессий
            </p>
          </div>
          <div className="flex gap-3">
            <Link to={createPageUrl('Templates')}>
              <Button variant="outline" className="gap-2">
                <Filter className="w-4 h-4" />
                Шаблоны
              </Button>
            </Link>
            <Link to={createPageUrl('CreateOrder')}>
              <Button className="bg-slate-900 hover:bg-slate-800 gap-2">
                <Plus className="w-4 h-4" />
                Новый заказ
              </Button>
            </Link>
          </div>
        </div>

        {/* Search and Filters */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-6">
          <div className="flex flex-col md:flex-row gap-3 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Поиск по номеру заказа, имени мамы или ребёнка..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <div className="flex gap-2">
              <OrdersFilters 
                filters={filters}
                onFiltersChange={setFilters}
                packages={packages}
              />
              {viewMode === 'grid' && (
                <Select value={getCurrentSortValue()} onValueChange={handleSortSelectChange}>
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="Сортировка" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="created_date-desc">По дате создания (новые)</SelectItem>
                    <SelectItem value="created_date-asc">По дате создания (старые)</SelectItem>
                    <SelectItem value="order_number-asc">По номеру (А-Я)</SelectItem>
                    <SelectItem value="order_number-desc">По номеру (Я-А)</SelectItem>
                    <SelectItem value="mother_name-asc">По имени мамы (А-Я)</SelectItem>
                    <SelectItem value="mother_name-desc">По имени мамы (Я-А)</SelectItem>
                    <SelectItem value="birth_date-desc">По дате рождения (новые)</SelectItem>
                    <SelectItem value="birth_date-asc">По дате рождения (старые)</SelectItem>
                    <SelectItem value="status-asc">По статусу</SelectItem>
                  </SelectContent>
                </Select>
              )}
              <ToggleGroup type="single" value={viewMode} onValueChange={(v) => v && setViewMode(v)}>
                <ToggleGroupItem value="grid" aria-label="Сетка">
                  <LayoutGrid className="w-4 h-4" />
                </ToggleGroupItem>
                <ToggleGroupItem value="list" aria-label="Список">
                  <List className="w-4 h-4" />
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
          </div>
          
          <Tabs value={filters.status} onValueChange={handleStatusChange}>
            <TabsList className="w-full justify-start overflow-x-auto">
              <TabsTrigger value="all" className="gap-2">
                Все <span className="text-xs bg-slate-100 px-2 py-0.5 rounded-full">{statusCounts.all}</span>
              </TabsTrigger>
              <TabsTrigger value="draft" className="gap-2">
                Черновики <span className="text-xs bg-slate-100 px-2 py-0.5 rounded-full">{statusCounts.draft}</span>
              </TabsTrigger>
              <TabsTrigger value="pending" className="gap-2">
                Ожидают <span className="text-xs bg-amber-100 px-2 py-0.5 rounded-full">{statusCounts.pending}</span>
              </TabsTrigger>
              <TabsTrigger value="processing" className="gap-2">
                В процессе <span className="text-xs bg-blue-100 px-2 py-0.5 rounded-full">{statusCounts.processing}</span>
              </TabsTrigger>
              <TabsTrigger value="review" className="gap-2">
                Проверка <span className="text-xs bg-purple-100 px-2 py-0.5 rounded-full">{statusCounts.review}</span>
              </TabsTrigger>
              <TabsTrigger value="completed" className="gap-2">
                Готовы <span className="text-xs bg-emerald-100 px-2 py-0.5 rounded-full">{statusCounts.completed}</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Orders Display */}
        {isLoading ? (
          viewMode === 'grid' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3, 4, 5, 6].map(i => (
                <div key={i} className="h-48 bg-slate-100 rounded-xl animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
              <div className="space-y-3">
                {[1, 2, 3, 4, 5].map(i => (
                  <div key={i} className="h-16 bg-slate-100 rounded animate-pulse" />
                ))}
              </div>
            </div>
          )
        ) : sortedOrders.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Search className="w-8 h-8 text-slate-400" />
            </div>
            <h3 className="text-lg font-medium text-slate-900 mb-2">
              {searchQuery ? 'Ничего не найдено' : 'Пока нет заказов'}
            </h3>
            <p className="text-slate-600 mb-6">
              {searchQuery ? 'Попробуйте изменить параметры поиска' : 'Создайте первый заказ для начала работы'}
            </p>
            {!searchQuery && (
              <Link to={createPageUrl('CreateOrder')}>
                <Button className="bg-slate-900 hover:bg-slate-800">
                  <Plus className="w-4 h-4 mr-2" />
                  Создать заказ
                </Button>
              </Link>
            )}
          </div>
        ) : (
          <>
            {viewMode === 'grid' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {paginatedOrders.map(order => (
                  <Link key={order.id} to={createPageUrl(`OrderDetails?id=${order.id}`)}>
                    <OrderCard order={order} />
                  </Link>
                ))}
              </div>
            ) : (
              <OrdersTable 
                orders={paginatedOrders}
                sortConfig={sortConfig}
                onSort={handleSort}
              />
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="mt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="text-sm text-slate-600">
                  Показано {(currentPage - 1) * itemsPerPage + 1}-{Math.min(currentPage * itemsPerPage, sortedOrders.length)} из {sortedOrders.length}
                </div>
                
                <div className="flex items-center gap-3">
                  <Select value={itemsPerPage.toString()} onValueChange={(v) => setItemsPerPage(parseInt(v))}>
                    <SelectTrigger className="w-[100px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="10">10</SelectItem>
                      <SelectItem value="12">12</SelectItem>
                      <SelectItem value="20">20</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                    </SelectContent>
                  </Select>

                  <Pagination>
                    <PaginationContent>
                      <PaginationItem>
                        <PaginationPrevious 
                          onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                          className={currentPage === 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                        />
                      </PaginationItem>
                      
                      {[...Array(totalPages)].map((_, i) => {
                        const pageNum = i + 1;
                        // Показываем первую, последнюю и страницы рядом с текущей
                        if (
                          pageNum === 1 ||
                          pageNum === totalPages ||
                          (pageNum >= currentPage - 1 && pageNum <= currentPage + 1)
                        ) {
                          return (
                            <PaginationItem key={pageNum}>
                              <PaginationLink
                                onClick={() => setCurrentPage(pageNum)}
                                isActive={currentPage === pageNum}
                                className="cursor-pointer"
                              >
                                {pageNum}
                              </PaginationLink>
                            </PaginationItem>
                          );
                        } else if (pageNum === currentPage - 2 || pageNum === currentPage + 2) {
                          return (
                            <PaginationItem key={pageNum}>
                              <PaginationEllipsis />
                            </PaginationItem>
                          );
                        }
                        return null;
                      })}
                      
                      <PaginationItem>
                        <PaginationNext 
                          onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                          className={currentPage === totalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                        />
                      </PaginationItem>
                    </PaginationContent>
                  </Pagination>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}