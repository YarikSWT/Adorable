import React from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Baby, Phone, Calendar, Clock, Package } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

const statusConfig = {
  draft: { label: "Черновик", color: "bg-slate-100 text-slate-700" },
  pending: { label: "Ожидает", color: "bg-amber-100 text-amber-700" },
  processing: { label: "Генерация", color: "bg-blue-100 text-blue-700" },
  review: { label: "На проверке", color: "bg-purple-100 text-purple-700" },
  completed: { label: "Готов", color: "bg-emerald-100 text-emerald-700" },
  archived: { label: "В архиве", color: "bg-gray-100 text-gray-600" }
};

const genderConfig = {
  boy: { label: "Мальчик", color: "text-sky-600" },
  girl: { label: "Девочка", color: "text-pink-500" }
};

export default function OrderCard({ order, onClick }) {
  const status = statusConfig[order.status] || statusConfig.draft;
  const gender = genderConfig[order.baby_gender] || genderConfig.boy;

  return (
    <Card 
      className="group cursor-pointer transition-all duration-300 hover:shadow-lg hover:shadow-slate-200/50 border-slate-200/60 hover:border-slate-300"
      onClick={onClick}
    >
      <CardContent className="p-5">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-medium text-slate-400 tracking-wide">
                #{order.order_number}
              </span>
              <Badge className={`${status.color} border-0 text-[10px] font-medium px-2`}>
                {status.label}
              </Badge>
            </div>
            <h3 className="font-semibold text-slate-900 text-lg">
              {order.mother_name}
            </h3>
          </div>
          <div className={`p-2 rounded-full ${order.baby_gender === 'girl' ? 'bg-pink-50' : 'bg-sky-50'}`}>
            <Baby className={`w-5 h-5 ${gender.color}`} />
          </div>
        </div>

        <div className="space-y-2 text-sm text-slate-600 mb-4">
          {order.baby_name && (
            <div className="flex items-center gap-2">
              <span className={`font-medium ${gender.color}`}>{order.baby_name}</span>
              <span className="text-slate-300">•</span>
              <span>{gender.label}</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Phone className="w-3.5 h-3.5 text-slate-400" />
            <span>{order.mother_phone}</span>
          </div>
          {order.birth_date && (
            <div className="flex items-center gap-2">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              <span>{format(new Date(order.birth_date), "d MMMM yyyy", { locale: ru })}</span>
              {order.birth_time && (
                <>
                  <Clock className="w-3.5 h-3.5 text-slate-400 ml-2" />
                  <span>{order.birth_time}</span>
                </>
              )}
            </div>
          )}
        </div>

        {order.status === 'processing' && (
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-slate-500">Прогресс генерации</span>
              <span className="font-medium text-slate-700">{order.progress || 0}%</span>
            </div>
            <Progress value={order.progress || 0} className="h-1.5" />
          </div>
        )}

        {order.photos && order.photos.length > 0 && (
          <div className="flex items-center gap-1 mt-3 pt-3 border-t border-slate-100">
            <Package className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-xs text-slate-500">
              {order.photos.length} фото загружено
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}