import React from 'react';
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import OrderForm from "../components/orders/OrderForm";
import { Link, useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function CreateOrderPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: packages = [] } = useQuery({
    queryKey: ['packages'],
    queryFn: () => base44.entities.TemplatePackage.list(),
  });

  const createOrderMutation = useMutation({
    mutationFn: (orderData) => base44.entities.Order.create(orderData),
    onSuccess: (newOrder) => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      navigate(createPageUrl(`OrderDetails?id=${newOrder.id}`));
    },
  });

  const handleSave = async (orderData) => {
    await createOrderMutation.mutateAsync(orderData);
  };

  const handleCancel = () => {
    navigate(createPageUrl('Orders'));
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50">
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="mb-6">
          <Link to={createPageUrl('Orders')}>
            <Button variant="ghost" className="gap-2 mb-4 -ml-2">
              <ArrowLeft className="w-4 h-4" />
              Назад к заказам
            </Button>
          </Link>
          <h1 className="text-3xl font-bold text-slate-900 mb-2">
            Новый заказ
          </h1>
          <p className="text-slate-600">
            Создайте заказ на генерацию newborn фотосессии
          </p>
        </div>

        <OrderForm 
          packages={packages}
          onSave={handleSave}
          onCancel={handleCancel}
        />
      </div>
    </div>
  );
}