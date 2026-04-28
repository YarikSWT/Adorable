import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Save, Loader2, Info } from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { extractErrorMessage } from "@/utils/errorUtils";
import { useToast } from "@/components/ui/use-toast";

export default function AlbumSellingTextSettingsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [templateText, setTemplateText] = useState('');
  const [templateId, setTemplateId] = useState(null);

  // Загружаем активный шаблон
  const { data: template, isLoading } = useQuery({
    queryKey: ['albumSellingTextTemplate'],
    queryFn: async () => {
      try {
        const templates = await base44.entities.AlbumSellingText.filter({ 
          is_active: true 
        });
        return templates.length > 0 ? templates[0] : null;
      } catch (error) {
        console.error('Ошибка загрузки шаблона:', error);
        return null;
      }
    },
  });

  useEffect(() => {
    if (template) {
      setTemplateText(template.selling_text || '');
      setTemplateId(template.id);
    } else if (!isLoading) {
      // Если шаблона нет, устанавливаем дефолтный текст
      setTemplateText(`Хотите сохранить эти волшебные моменты на всегда?

Закажите профессиональный печатный альбом с вашими фотографиями! 
Высококачественная печать, премиум-материалы, безупречный дизайн.

{{baby_name}} будет любоваться этой книгой всю жизнь!

Превью альбома: {{album_preview_url}}`);
    }
  }, [template, isLoading]);

  const saveMutation = useMutation({
    mutationFn: async (data) => {
      if (templateId) {
        // Обновляем существующий шаблон
        return await base44.entities.AlbumSellingText.update(templateId, data);
      } else {
        // Создаем новый шаблон
        return await base44.entities.AlbumSellingText.create({
          ...data,
          is_active: true
        });
      }
    },
    onSuccess: (savedTemplate) => {
      queryClient.invalidateQueries({ queryKey: ['albumSellingTextTemplate'] });
      setTemplateId(savedTemplate.id);
      toast({
        title: "Шаблон сохранен",
        description: "Продающий текст для альбома успешно обновлен",
      });
    },
    onError: (error) => {
      toast({
        title: "Ошибка сохранения",
        description: extractErrorMessage(error, "Не удалось сохранить шаблон"),
        variant: "destructive",
      });
    },
  });

  const handleSave = async (e) => {
    e.preventDefault();
    if (!templateText.trim()) {
      toast({
        title: "Ошибка",
        description: "Текст шаблона не может быть пустым",
        variant: "destructive",
      });
      return;
    }

    await saveMutation.mutateAsync({
      selling_text: templateText.trim(),
      is_active: true
    });
  };

  const placeholders = [
    { name: '{{baby_name}}', description: 'Имя ребенка' },
    { name: '{{baby_gender}}', description: 'Пол ребенка (Мальчик/Девочка)' },
    { name: '{{baby_weight}}', description: 'Вес ребенка' },
    { name: '{{baby_height}}', description: 'Рост ребенка' },
    { name: '{{birth_date}}', description: 'Дата рождения (форматированная)' },
    { name: '{{birth_time}}', description: 'Время рождения' },
    { name: '{{album_preview_url}}', description: 'Ссылка на превью альбома' },
    { name: '{{archive_url}}', description: 'Ссылка на архив' },
  ];

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="mb-6">
          <Link to={createPageUrl('Orders')}>
            <Button variant="ghost" className="gap-2 mb-4 -ml-2">
              <ArrowLeft className="w-4 h-4" />
              Назад к заказам
            </Button>
          </Link>
          <h1 className="text-3xl font-bold text-slate-900 mb-2">
            Настройки продающего текста для альбомов
          </h1>
          <p className="text-slate-600">
            Редактируйте шаблон текста, который будет отображаться в превью заказа для стимулирования допродажи печатных альбомов
          </p>
        </div>

        <form onSubmit={handleSave} className="space-y-6">
          <Card className="border-slate-200">
            <CardHeader>
              <CardTitle>Продающий текст</CardTitle>
              <CardDescription>
                Этот текст будет отображаться внизу страницы превью заказа с ссылкой на превью напечатанного альбома
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="template">Текст шаблона</Label>
                <Textarea
                  id="template"
                  value={templateText}
                  onChange={(e) => setTemplateText(e.target.value)}
                  placeholder="Введите продающий текст..."
                  className="min-h-[300px] font-mono text-sm"
                />
              </div>

              <Card className="bg-slate-50 border-slate-200">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Info className="w-4 h-4" />
                    Доступные плейсхолдеры
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {placeholders.map((placeholder) => (
                      <div
                        key={placeholder.name}
                        className="flex items-center gap-2 p-2 bg-white rounded border border-slate-200 cursor-pointer hover:bg-slate-50"
                        onClick={() => {
                          const textarea = document.getElementById('template');
                          const start = textarea.selectionStart;
                          const end = textarea.selectionEnd;
                          const newText = 
                            templateText.substring(0, start) + 
                            placeholder.name + 
                            templateText.substring(end);
                          setTemplateText(newText);
                          // Устанавливаем курсор после вставленного текста
                          setTimeout(() => {
                            textarea.focus();
                            textarea.setSelectionRange(
                              start + placeholder.name.length,
                              start + placeholder.name.length
                            );
                          }, 0);
                        }}
                      >
                        <code className="text-xs bg-slate-100 px-2 py-1 rounded font-mono">
                          {placeholder.name}
                        </code>
                        <span className="text-xs text-slate-600">
                          {placeholder.description}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-slate-500 mt-3">
                    Нажмите на плейсхолдер, чтобы вставить его в текст
                  </p>
                </CardContent>
              </Card>
            </CardContent>
          </Card>

          <div className="flex justify-end gap-3">
            <Link to={createPageUrl('Orders')}>
              <Button type="button" variant="outline">
                Отмена
              </Button>
            </Link>
            <Button 
              type="submit" 
              className="bg-slate-900 hover:bg-slate-800"
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Сохранение...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 mr-2" />
                  Сохранить
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}