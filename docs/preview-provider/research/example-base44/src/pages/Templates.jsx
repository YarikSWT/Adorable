import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, ArrowLeft, Edit, Trash2, Eye } from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import TemplatePackageForm from "../components/templates/TemplatePackageForm";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function TemplatesPage() {
  const queryClient = useQueryClient();
  const [isCreating, setIsCreating] = useState(false);
  const [editingPackage, setEditingPackage] = useState(null);
  const [viewingPackage, setViewingPackage] = useState(null);

  const { data: packages = [], isLoading } = useQuery({
    queryKey: ['packages'],
    queryFn: () => base44.entities.TemplatePackage.list('-created_date'),
  });

  const createPackageMutation = useMutation({
    mutationFn: async (data) => {
      const result = await base44.entities.TemplatePackage.create(data);
      return result;
    },
    onSuccess: (newPackage) => {
      queryClient.invalidateQueries({ queryKey: ['packages'] });
      // Переключаемся в режим редактирования созданного пакета
      if (newPackage) {
        setEditingPackage(newPackage);
      }
      setIsCreating(false);
    },
  });

  const updatePackageMutation = useMutation({
    mutationFn: async ({ id, data }) => {
      const result = await base44.entities.TemplatePackage.update(id, data);
      return result;
    },
    onSuccess: (updatedPackage) => {
      queryClient.invalidateQueries({ queryKey: ['packages'] });
      // Обновляем редактируемый пакет с актуальными данными
      if (updatedPackage) {
        setEditingPackage(updatedPackage);
      }
    },
  });

  const deletePackageMutation = useMutation({
    mutationFn: (id) => base44.entities.TemplatePackage.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['packages'] });
    },
  });

  const handleSave = async (data) => {
    if (editingPackage) {
      const updated = await updatePackageMutation.mutateAsync({ id: editingPackage.id, data });
      return updated;
    } else {
      const created = await createPackageMutation.mutateAsync(data);
      return created;
    }
  };

  const handleDelete = async (pkg) => {
    if (confirm(`Удалить пакет "${pkg.name}"?`)) {
      await deletePackageMutation.mutateAsync(pkg.id);
    }
  };

  if (isCreating || editingPackage) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50">
        <div className="max-w-5xl mx-auto px-4 py-8">
          <div className="mb-6">
            <Button 
              variant="ghost" 
              className="gap-2 mb-4 -ml-2" 
              onClick={() => {
                setIsCreating(false);
                setEditingPackage(null);
              }}
            >
              <ArrowLeft className="w-4 h-4" />
              Назад к пакетам
            </Button>
            <h1 className="text-3xl font-bold text-slate-900 mb-2">
              {editingPackage ? 'Редактирование пакета' : 'Новый пакет шаблонов'}
            </h1>
          </div>

          <TemplatePackageForm 
            pkg={editingPackage}
            onSave={handleSave}
            onCancel={() => {
              setIsCreating(false);
              setEditingPackage(null);
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <Link to={createPageUrl('Orders')}>
              <Button variant="ghost" className="gap-2 mb-4 -ml-2">
                <ArrowLeft className="w-4 h-4" />
                Назад к заказам
              </Button>
            </Link>
            <h1 className="text-3xl font-bold text-slate-900 mb-2">
              Пакеты шаблонов
            </h1>
            <p className="text-slate-600">
              Управление шаблонами промптов для генерации
            </p>
          </div>
          <Button 
            className="bg-slate-900 hover:bg-slate-800 gap-2"
            onClick={() => setIsCreating(true)}
          >
            <Plus className="w-4 h-4" />
            Создать пакет
          </Button>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-48 bg-slate-100 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : packages.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Plus className="w-8 h-8 text-slate-400" />
            </div>
            <h3 className="text-lg font-medium text-slate-900 mb-2">
              Пока нет пакетов
            </h3>
            <p className="text-slate-600 mb-6">
              Создайте первый пакет шаблонов для генерации
            </p>
            <Button 
              className="bg-slate-900 hover:bg-slate-800"
              onClick={() => setIsCreating(true)}
            >
              <Plus className="w-4 h-4 mr-2" />
              Создать пакет
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {packages.map(pkg => (
              <Card 
                key={pkg.id}
                className="border-slate-200 hover:border-slate-300 transition-colors group"
              >
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle className="text-lg mb-2">{pkg.name}</CardTitle>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="outline">
                          {pkg.gender === 'boy' ? 'Мальчик' : pkg.gender === 'girl' ? 'Девочка' : 'Универсальный'}
                        </Badge>
                        <Badge className={pkg.is_active !== false ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-700'}>
                          {pkg.is_active !== false ? 'Активен' : 'Неактивен'}
                        </Badge>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {pkg.description && (
                    <p className="text-sm text-slate-600 mb-4 line-clamp-2">
                      {pkg.description}
                    </p>
                  )}
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500">
                      {pkg.templates?.length || 0} шаблонов
                    </span>
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setViewingPackage(pkg)}
                      >
                        <Eye className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingPackage(pkg)}
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(pkg)}
                        className="text-red-500 hover:text-red-600 hover:bg-red-50"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={!!viewingPackage} onOpenChange={() => setViewingPackage(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{viewingPackage?.name}</DialogTitle>
            <DialogDescription>
              {viewingPackage?.description}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-4">
            {viewingPackage?.templates?.map((template, index) => (
              <div key={template.id} className="p-4 border border-slate-200 rounded-lg">
                <div className="flex items-start gap-3 mb-2">
                  <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2 py-1 rounded">
                    #{index + 1}
                  </span>
                  <h4 className="font-medium flex-1">{template.name}</h4>
                </div>
                <p className="text-sm text-slate-600 pl-9 whitespace-pre-wrap">
                  {template.prompt}
                </p>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}