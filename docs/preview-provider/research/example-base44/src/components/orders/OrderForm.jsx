import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Upload, X, Loader2, Save, Baby } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { extractErrorMessage } from "@/utils/errorUtils";
import { useToast } from "@/components/ui/use-toast";

export default function OrderForm({ order, packages, onSave, onCancel }) {
  const { toast } = useToast();
  const [formData, setFormData] = useState({
    order_number: '',
    mother_name: '',
    mother_phone: '',
    baby_name: '',
    baby_gender: 'boy',
    baby_weight: '',
    baby_height: '',
    birth_date: '',
    birth_time: '',
    template_package_id: '',
    notes: '',
    photos: [],
    status: 'draft',
    progress: 0,
    generated_images: []
  });
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (order) {
      setFormData({
        ...order,
        baby_weight: order.baby_weight || '',
        baby_height: order.baby_height || ''
      });
    }
  }, [order]);

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handlePhotoUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    if ((formData.photos?.length || 0) + files.length > 12) {
      toast({
        title: "Превышен лимит",
        description: "Максимум 12 фотографий",
        variant: "destructive",
      });
      return;
    }

    setUploading(true);
    try {
      const newPhotos = [...(formData.photos || [])];

      for (const file of files) {
        const { file_url } = await base44.integrations.Core.UploadFile({ file });
        newPhotos.push(file_url);
      }

      setFormData(prev => ({ ...prev, photos: newPhotos }));
    } catch (error) {
      toast({
        title: "Ошибка загрузки",
        description: extractErrorMessage(error, 'Не удалось загрузить фотографии'),
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const removePhoto = (index) => {
    setFormData(prev => ({
      ...prev,
      photos: prev.photos.filter((_, i) => i !== index)
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    
    const dataToSave = {
      ...formData,
      baby_weight: formData.baby_weight ? parseFloat(formData.baby_weight) : null,
      baby_height: formData.baby_height ? parseFloat(formData.baby_height) : null
    };
    
    await onSave(dataToSave);
    setSaving(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card className="border-slate-200">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <span className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-sm">1</span>
            Информация о заказе
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="order_number">Номер заказа *</Label>
              <Input
                id="order_number"
                value={formData.order_number}
                onChange={(e) => handleChange('order_number', e.target.value)}
                placeholder="ORD-001"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="template_package_id">Пакет шаблонов</Label>
              <Select 
                value={formData.template_package_id} 
                onValueChange={(v) => handleChange('template_package_id', v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Выберите пакет" />
                </SelectTrigger>
                <SelectContent>
                  {packages?.filter(p => p.is_active !== false && (p.gender === formData.baby_gender || p.gender === 'unisex')).map(pkg => (
                    <SelectItem key={pkg.id} value={pkg.id}>
                      {pkg.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <span className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-sm">2</span>
            Данные мамы
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="mother_name">Имя мамы *</Label>
              <Input
                id="mother_name"
                value={formData.mother_name}
                onChange={(e) => handleChange('mother_name', e.target.value)}
                placeholder="Анна Иванова"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mother_phone">Телефон мамы *</Label>
              <Input
                id="mother_phone"
                value={formData.mother_phone}
                onChange={(e) => handleChange('mother_phone', e.target.value)}
                placeholder="+7 999 123 45 67"
                required
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <span className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-sm">3</span>
            Данные ребёнка
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="baby_name">Имя ребёнка</Label>
              <Input
                id="baby_name"
                value={formData.baby_name}
                onChange={(e) => handleChange('baby_name', e.target.value)}
                placeholder="Миша"
              />
            </div>
            <div className="space-y-2">
              <Label>Пол ребёнка *</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={formData.baby_gender === 'boy' ? 'default' : 'outline'}
                  className={formData.baby_gender === 'boy' ? 'bg-sky-500 hover:bg-sky-600 flex-1' : 'flex-1'}
                  onClick={() => handleChange('baby_gender', 'boy')}
                >
                  <Baby className="w-4 h-4 mr-2" />
                  Мальчик
                </Button>
                <Button
                  type="button"
                  variant={formData.baby_gender === 'girl' ? 'default' : 'outline'}
                  className={formData.baby_gender === 'girl' ? 'bg-pink-500 hover:bg-pink-600 flex-1' : 'flex-1'}
                  onClick={() => handleChange('baby_gender', 'girl')}
                >
                  <Baby className="w-4 h-4 mr-2" />
                  Девочка
                </Button>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label htmlFor="baby_weight">Вес (кг)</Label>
              <Input
                id="baby_weight"
                type="number"
                step="0.1"
                value={formData.baby_weight}
                onChange={(e) => handleChange('baby_weight', e.target.value)}
                placeholder="3.5"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="baby_height">Рост (см)</Label>
              <Input
                id="baby_height"
                type="number"
                value={formData.baby_height}
                onChange={(e) => handleChange('baby_height', e.target.value)}
                placeholder="52"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="birth_date">Дата рождения</Label>
              <Input
                id="birth_date"
                type="date"
                value={formData.birth_date}
                onChange={(e) => handleChange('birth_date', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="birth_time">Время рождения</Label>
              <Input
                id="birth_time"
                type="time"
                value={formData.birth_time}
                onChange={(e) => handleChange('birth_time', e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <span className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-sm">4</span>
            Фотографии ребёнка
            <span className="text-sm font-normal text-slate-500 ml-auto">
              {formData.photos?.length || 0} / 12
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
            {formData.photos?.map((photo, index) => (
              <div key={index} className="relative aspect-square rounded-lg overflow-hidden group">
                <img src={photo} alt={`Фото ${index + 1}`} className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={() => removePhoto(index)}
                  className="absolute top-1 right-1 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
            {(formData.photos?.length || 0) < 12 && (
              <label className="aspect-square rounded-lg border-2 border-dashed border-slate-300 hover:border-slate-400 flex flex-col items-center justify-center cursor-pointer transition-colors">
                {uploading ? (
                  <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
                ) : (
                  <>
                    <Upload className="w-6 h-6 text-slate-400 mb-1" />
                    <span className="text-xs text-slate-500">Загрузить</span>
                  </>
                )}
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={handlePhotoUpload}
                  disabled={uploading}
                />
              </label>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <span className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-sm">5</span>
            Дополнительно
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Label htmlFor="notes">Заметки</Label>
            <Textarea
              id="notes"
              value={formData.notes || ''}
              onChange={(e) => handleChange('notes', e.target.value)}
              placeholder="Дополнительные пожелания или комментарии..."
              rows={3}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-3 pt-4">
        <Button type="button" variant="outline" onClick={onCancel}>
          Отмена
        </Button>
        <Button type="submit" disabled={saving} className="bg-slate-900 hover:bg-slate-800">
          {saving ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Сохранение...
            </>
          ) : (
            <>
              <Save className="w-4 h-4 mr-2" />
              {order ? 'Сохранить' : 'Создать заказ'}
            </>
          )}
        </Button>
      </div>
    </form>
  );
}