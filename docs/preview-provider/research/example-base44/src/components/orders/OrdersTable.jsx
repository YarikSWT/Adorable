import React from 'react';
import { Link } from 'react-router-dom';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Baby, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { createPageUrl } from "@/utils";
import { cn } from "@/lib/utils";

const statusConfig = {
  draft: { label: "Черновик", color: "bg-slate-100 text-slate-700" },
  pending: { label: "Ожидает", color: "bg-amber-100 text-amber-700" },
  processing: { label: "Генерация", color: "bg-blue-100 text-blue-700" },
  review: { label: "На проверке", color: "bg-purple-100 text-purple-700" },
  completed: { label: "Готов", color: "bg-emerald-100 text-emerald-700" },
  archived: { label: "В архиве", color: "bg-gray-100 text-gray-600" }
};

const genderConfig = {
  boy: { label: "Мальчик", icon: "👦" },
  girl: { label: "Девочка", icon: "👧" }
};

export default function OrdersTable({ orders, sortConfig, onSort }) {
  const getSortIcon = (field) => {
    if (sortConfig.field !== field) {
      return <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />;
    }
    return sortConfig.direction === 'asc' 
      ? <ArrowUp className="w-3.5 h-3.5 text-slate-700" />
      : <ArrowDown className="w-3.5 h-3.5 text-slate-700" />;
  };

  const handleSort = (field) => {
    if (onSort) {
      onSort(field);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-slate-50">
            <TableHead 
              className="cursor-pointer hover:bg-slate-100 transition-colors"
              onClick={() => handleSort('order_number')}
            >
              <div className="flex items-center gap-2">
                Номер заказа
                {getSortIcon('order_number')}
              </div>
            </TableHead>
            <TableHead 
              className="cursor-pointer hover:bg-slate-100 transition-colors"
              onClick={() => handleSort('mother_name')}
            >
              <div className="flex items-center gap-2">
                Мама / Контакт
                {getSortIcon('mother_name')}
              </div>
            </TableHead>
            <TableHead>
              Ребёнок
            </TableHead>
            <TableHead 
              className="cursor-pointer hover:bg-slate-100 transition-colors"
              onClick={() => handleSort('birth_date')}
            >
              <div className="flex items-center gap-2">
                Дата рождения
                {getSortIcon('birth_date')}
              </div>
            </TableHead>
            <TableHead 
              className="cursor-pointer hover:bg-slate-100 transition-colors"
              onClick={() => handleSort('status')}
            >
              <div className="flex items-center gap-2">
                Статус
                {getSortIcon('status')}
              </div>
            </TableHead>
            <TableHead 
              className="cursor-pointer hover:bg-slate-100 transition-colors"
              onClick={() => handleSort('created_date')}
            >
              <div className="flex items-center gap-2">
                Создан
                {getSortIcon('created_date')}
              </div>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.map(order => {
            const status = statusConfig[order.status] || statusConfig.draft;
            const gender = genderConfig[order.baby_gender] || genderConfig.boy;
            
            return (
              <TableRow 
                key={order.id} 
                className="cursor-pointer hover:bg-slate-50"
              >
                <TableCell className="font-medium">
                  <Link 
                    to={createPageUrl(`OrderDetails?id=${order.id}`)}
                    className="text-slate-900 hover:text-slate-600"
                  >
                    #{order.order_number}
                  </Link>
                </TableCell>
                <TableCell>
                  <Link to={createPageUrl(`OrderDetails?id=${order.id}`)}>
                    <div className="flex flex-col">
                      <span className="font-medium text-slate-900">{order.mother_name}</span>
                      <span className="text-sm text-slate-500">{order.mother_phone}</span>
                    </div>
                  </Link>
                </TableCell>
                <TableCell>
                  <Link to={createPageUrl(`OrderDetails?id=${order.id}`)}>
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{gender.icon}</span>
                      <div className="flex flex-col">
                        {order.baby_name && (
                          <span className="font-medium text-slate-900">{order.baby_name}</span>
                        )}
                        <span className="text-sm text-slate-500">{gender.label}</span>
                      </div>
                    </div>
                  </Link>
                </TableCell>
                <TableCell>
                  <Link to={createPageUrl(`OrderDetails?id=${order.id}`)}>
                    {order.birth_date ? (
                      <span className="text-sm text-slate-700">
                        {format(new Date(order.birth_date), "d MMM yyyy", { locale: ru })}
                      </span>
                    ) : (
                      <span className="text-sm text-slate-400">—</span>
                    )}
                  </Link>
                </TableCell>
                <TableCell>
                  <Link to={createPageUrl(`OrderDetails?id=${order.id}`)}>
                    <Badge className={cn(status.color, "border-0 text-xs")}>
                      {status.label}
                    </Badge>
                  </Link>
                </TableCell>
                <TableCell>
                  <Link to={createPageUrl(`OrderDetails?id=${order.id}`)}>
                    {order.created_date ? (
                      <span className="text-sm text-slate-500">
                        {format(new Date(order.created_date), "d MMM yyyy", { locale: ru })}
                      </span>
                    ) : (
                      <span className="text-sm text-slate-400">—</span>
                    )}
                  </Link>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
