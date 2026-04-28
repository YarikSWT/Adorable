import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2, Save, Loader2, GripVertical, Upload, X, Sparkles, Image as ImageIcon } from "lucide-react";
import { v4 as uuidv4 } from 'uuid';
import { base44 } from "@/api/base44Client";
import { extractErrorMessage, extractResponseError } from "@/utils/errorUtils";
import { useToast } from "@/components/ui/use-toast";

export default function TemplatePackageForm({ pkg, onSave, onCancel }) {
  const { toast } = useToast();
  const [formData, setFormData] = useState({
    name: '',
    gender: 'unisex',
    description: '',
    templates: [],
    is_active: true,
    test_image_url: '',
    album_preview_template: null
  });
  const [saving, setSaving] = useState(false);
  const [uploadingTestImage, setUploadingTestImage] = useState(false);
  const [generatingTemplateIds, setGeneratingTemplateIds] = useState(new Set());

  useEffect(() => {
    if (pkg) {
      setFormData({
        name: pkg.name || '',
        gender: pkg.gender || 'unisex',
        description: pkg.description || '',
        templates: pkg.templates || [],
        is_active: pkg.is_active !== false,
        test_image_url: pkg.test_image_url || '',
        album_preview_template: pkg.album_preview_template || null
      });
    }
  }, [pkg]);

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const addTemplate = () => {
    setFormData(prev => ({
      ...prev,
      templates: [
        ...prev.templates,
        {
          id: uuidv4(),
          name: '',
          prompt: '',
          preview_url: ''
        }
      ]
    }));
  };

  const updateTemplate = (index, field, value) => {
    setFormData(prev => ({
      ...prev,
      templates: prev.templates.map((t, i) => 
        i === index ? { ...t, [field]: value } : t
      )
    }));
  };

  const removeTemplate = (index) => {
    setFormData(prev => ({
      ...prev,
      templates: prev.templates.filter((_, i) => i !== index)
    }));
  };

  const handleTestImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploadingTestImage(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      handleChange('test_image_url', file_url);
    } catch (error) {
      toast({
        title: "Ошибка загрузки",
        description: extractErrorMessage(error, 'Не удалось загрузить изображение'),
        variant: "destructive",
      });
    } finally {
      setUploadingTestImage(false);
    }
  };

  const removeTestImage = () => {
    handleChange('test_image_url', '');
  };

  const handleGeneratePreview = async (templateId, templateIndex) => {
    setGeneratingTemplateIds(prev => new Set(prev).add(templateId));

    try {
      let packageId = pkg?.id;

      // Если пакет еще не создан, сначала сохраняем его
      if (!packageId) {
        const savedPackage = await onSave(formData);
        if (savedPackage && savedPackage.id) {
          packageId = savedPackage.id;
        } else {
          toast({
            title: "Ошибка",
            description: "Не удалось создать пакет. Пожалуйста, сохраните пакет вручную и попробуйте снова.",
            variant: "destructive",
          });
          return;
        }
      }

      const response = await base44.functions.invoke('generateTemplatePreview', {
        packageId: packageId,
        templateId: templateId,
        testImageUrl: formData.test_image_url
      });

      if (response.data.success && response.data.imageUrl) {
        // Обновляем preview_url для конкретного шаблона
        const updatedTemplates = formData.templates.map((template) => {
          if (template.id === templateId) {
            return { ...template, preview_url: response.data.imageUrl };
          }
          return template;
        });

        const updatedFormData = { ...formData, templates: updatedTemplates };
        setFormData(updatedFormData);

        // Сохраняем обновленные шаблоны в БД
        if (packageId) {
          await onSave(updatedFormData);
        }

        toast({
          title: "Превью создано",
          description: "Пример изображения успешно сгенерирован",
        });
      } else {
        toast({
          title: "Ошибка генерации превью",
          description: extractResponseError(response.data, 'Не удалось сгенерировать превью'),
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Ошибка генерации превью",
        description: extractErrorMessage(error, 'Не удалось сгенерировать превью'),
        variant: "destructive",
      });
    } finally {
      setGeneratingTemplateIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(templateId);
        return newSet;
      });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const result = await onSave(formData);
      // Если это был новый пакет, обновляем formData с полученными данными
      if (result && !pkg) {
        setFormData(result);
      }
    } finally {
      setSaving(false);
    }
  };

  const variableHints = [
    { var: '[имя]', desc: 'Имя ребёнка' },
    { var: '[вес]', desc: 'Вес в кг' },
    { var: '[рост]', desc: 'Рост в см' },
    { var: '[дата]', desc: 'Дата рождения' },
    { var: '[время]', desc: 'Время рождения' }
  ];

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card className="border-slate-200">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg font-semibold text-slate-900">
            Основная информация
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Название пакета *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => handleChange('name', e.target.value)}
                placeholder="Newborn Классика"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gender">Для кого</Label>
              <Select value={formData.gender} onValueChange={(v) => handleChange('gender', v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="boy">Мальчики</SelectItem>
                  <SelectItem value="girl">Девочки</SelectItem>
                  <SelectItem value="unisex">Универсальный</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Описание</Label>
            <Textarea
              id="description"
              value={formData.description || ''}
              onChange={(e) => handleChange('description', e.target.value)}
              placeholder="Описание пакета шаблонов..."
              rows={2}
            />
          </div>
          <div className="flex items-center gap-3">
            <Switch
              checked={formData.is_active}
              onCheckedChange={(v) => handleChange('is_active', v)}
            />
            <Label>Пакет активен</Label>
          </div>
          <div className="space-y-2">
            <Label>Тестовое изображение для генерации примеров</Label>
            {formData.test_image_url ? (
              <div className="relative inline-block">
                <div className="w-32 h-32 rounded-lg overflow-hidden border-2 border-slate-200">
                  <img 
                    src={formData.test_image_url} 
                    alt="Тестовое изображение" 
                    className="w-full h-full object-cover"
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-red-500 hover:bg-red-600 text-white"
                  onClick={removeTestImage}
                >
                  <X className="w-3 h-3" />
                </Button>
              </div>
            ) : (
              <label className="w-32 h-32 rounded-lg border-2 border-dashed border-slate-300 hover:border-slate-400 flex flex-col items-center justify-center cursor-pointer transition-colors">
                {uploadingTestImage ? (
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
                  className="hidden"
                  onChange={handleTestImageUpload}
                  disabled={uploadingTestImage}
                />
              </label>
            )}
            <p className="text-xs text-slate-500">
              Это изображение будет использовано для генерации примеров по всем шаблонам
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg font-semibold text-slate-900">
              Шаблоны ({formData.templates.length})
            </CardTitle>
            <Button type="button" variant="outline" size="sm" onClick={addTemplate}>
              <Plus className="w-4 h-4 mr-2" />
              Добавить шаблон
            </Button>
          </div>
          <div className="flex flex-wrap gap-2 mt-3">
            {variableHints.map(hint => (
              <span 
                key={hint.var}
                className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded"
                title={hint.desc}
              >
                {hint.var}
              </span>
            ))}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {formData.templates.length === 0 ? (
            <div className="text-center py-8 text-slate-500">
              Добавьте шаблоны с промптами для генерации
            </div>
          ) : (
            formData.templates.map((template, index) => (
              <div 
                key={template.id} 
                className="p-4 border border-slate-200 rounded-lg space-y-3 bg-slate-50/50"
              >
                <div className="flex items-start gap-3">
                  <div className="pt-2">
                    <GripVertical className="w-4 h-4 text-slate-400" />
                  </div>
                  <div className="flex-1 space-y-3">
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-medium text-slate-500 w-6">
                        #{index + 1}
                      </span>
                      <Input
                        value={template.name}
                        onChange={(e) => updateTemplate(index, 'name', e.target.value)}
                        placeholder="Название образа"
                        className="flex-1"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleGeneratePreview(template.id, index)}
                        disabled={generatingTemplateIds.has(template.id) || (!pkg?.id && !formData.name)}
                        className="bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200"
                      >
                        {generatingTemplateIds.has(template.id) ? (
                          <>
                            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                            Генерация...
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-3 h-3 mr-1" />
                            Пример
                          </>
                        )}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeTemplate(index)}
                        className="text-red-500 hover:text-red-600 hover:bg-red-50"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                    <Textarea
                      value={template.prompt}
                      onChange={(e) => updateTemplate(index, 'prompt', e.target.value)}
                      placeholder="Промпт для генерации. Используйте переменные: [имя], [вес], [рост], [дата], [время]"
                      rows={3}
                      className="text-sm"
                    />
                    {template.preview_url && (
                      <div className="mt-2 p-2 bg-white rounded border border-slate-200">
                        <div className="flex items-center gap-2 mb-2">
                          <ImageIcon className="w-4 h-4 text-slate-500" />
                          <span className="text-xs font-medium text-slate-600">Пример генерации:</span>
                        </div>
                        <div className="w-full max-w-xs rounded overflow-hidden border border-slate-200">
                          <img 
                            src={template.preview_url} 
                            alt={`Пример для ${template.name || `шаблона ${index + 1}`}`}
                            className="w-full h-auto"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card className="border-slate-200">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg font-semibold text-slate-900">
            Шаблон превью напечатанного альбома
          </CardTitle>
          <p className="text-sm text-slate-600 mt-1">
            Используется для генерации мокапа печатного альбома с фотографиями заказа
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {formData.album_preview_template ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="album_preview_name">Название шаблона</Label>
                  <Input
                    id="album_preview_name"
                    value={formData.album_preview_template.name || ''}
                    onChange={(e) => handleChange('album_preview_template', { 
                      ...formData.album_preview_template, 
                      name: e.target.value 
                    })}
                    placeholder="Превью напечатанного альбома"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="album_preview_id">ID шаблона</Label>
                  <Input
                    id="album_preview_id"
                    value={formData.album_preview_template.id || ''}
                    onChange={(e) => handleChange('album_preview_template', { 
                      ...formData.album_preview_template, 
                      id: e.target.value 
                    })}
                    placeholder="album_preview_001"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="album_preview_prompt">Промпт для генерации мокапа</Label>
                <Textarea
                  id="album_preview_prompt"
                  value={formData.album_preview_template.prompt || ''}
                  onChange={(e) => handleChange('album_preview_template', { 
                    ...formData.album_preview_template, 
                    prompt: e.target.value 
                  })}
                  placeholder="Создайте реалистичный мокап красивого печатного альбома с фотографией ребенка. Альбом должен быть открыт на странице с фотографией..."
                  rows={4}
                  className="text-sm"
                />
                <p className="text-xs text-slate-500">
                  Этот промпт будет использован для генерации реалистичного изображения печатного альбома с выбранной фотографией
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleChange('album_preview_template', null)}
                className="text-red-600 border-red-200 hover:bg-red-50"
              >
                Удалить шаблон превью альбома
              </Button>
            </div>
          ) : (
            <div className="text-center py-8">
              <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <ImageIcon className="w-8 h-8 text-slate-400" />
              </div>
              <h3 className="text-lg font-medium text-slate-900 mb-2">
                Шаблон превью альбома не добавлен
              </h3>
              <p className="text-slate-600 mb-6">
                Добавьте шаблон для генерации мокапа печатного альбома
              </p>
              <Button 
                variant="outline"
                onClick={() => handleChange('album_preview_template', {
                  id: `album_preview_${Date.now()}`,
                  name: 'Превью напечатанного альбома',
                  prompt: 'Создайте реалистичный мокап красивого печатного фотоальбома на деревянном столе. Альбом должен быть открыт на странице с фотографией ребенка. Мягкий свет, профессиональная фотография, высокое качество, детализация.'
                })}
              >
                <Plus className="w-4 h-4 mr-2" />
                Добавить шаблон
              </Button>
            </div>
          )}
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
              {pkg ? 'Сохранить' : 'Создать пакет'}
            </>
          )}
        </Button>
      </div>
    </form>
  );
}