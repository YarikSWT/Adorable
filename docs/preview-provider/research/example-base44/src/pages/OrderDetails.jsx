import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Edit, Sparkles, Download, Baby, Phone, Calendar, Clock, Package, CheckCircle2, Loader2, XCircle, Zap, RefreshCw, Copy, Eye, Send } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { Link, useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { generateArchiveMessage } from "@/utils/archiveMessage";
import { extractErrorMessage, extractResponseError } from "@/utils/errorUtils";
import { useToast } from "@/components/ui/use-toast";
import GenerationGallery from "../components/generation/GenerationGallery";
import OrderForm from "../components/orders/OrderForm";

export default function OrderDetailsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const urlParams = new URLSearchParams(window.location.search);
  const orderId = urlParams.get('id');
  
  const [isEditing, setIsEditing] = useState(false);
  const [regeneratingIds, setRegeneratingIds] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [isCreatingPreview, setIsCreatingPreview] = useState(false);
  const [isSendingPreview, setIsSendingPreview] = useState(false);
  const [selectedPhotoForAlbumPreview, setSelectedPhotoForAlbumPreview] = useState(null);
  const [isGeneratingAlbumPreview, setIsGeneratingAlbumPreview] = useState(false);
  const [useAsyncMode, setUseAsyncMode] = useState(() => {
    // Сохраняем выбор в localStorage. По умолчанию включаем async (параллельную) генерацию.
    const stored = localStorage.getItem('generation_mode');
    if (stored === null) {
      localStorage.setItem('generation_mode', 'async');
      return true;
    }
    return stored === 'async';
  });

  const { data: order, isLoading } = useQuery({
    queryKey: ['order', orderId],
    queryFn: async () => {
      const orders = await base44.entities.Order.filter({ id: orderId });
      return orders[0];
    },
    enabled: !!orderId,
    refetchInterval: (query) => {
      // Автообновление если есть изображения требующие проверки статуса
      const hasImagesToCheck = query?.state?.data?.generated_images?.some(
        img => (img.status === 'generating' || img.status === 'pending' || img.status === 'failed') && img.async_task_id
      );
      return hasImagesToCheck ? 3000 : false; // Обновлять каждые 3 секунды
    },
  });

  const { data: packages = [] } = useQuery({
    queryKey: ['packages'],
    queryFn: () => base44.entities.TemplatePackage.list(),
  });

  const { data: selectedPackage } = useQuery({
    queryKey: ['package', order?.template_package_id],
    queryFn: async () => {
      if (!order?.template_package_id) return null;
      const pkgs = await base44.entities.TemplatePackage.filter({ id: order.template_package_id });
      return pkgs[0];
    },
    enabled: !!order?.template_package_id,
  });

  const updateOrderMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Order.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order', orderId] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      setIsEditing(false);
    },
  });

  const handleSave = async (orderData) => {
    await updateOrderMutation.mutateAsync({ id: orderId, data: orderData });
  };

  const handleStartGeneration = async () => {
    if (!order.template_package_id || !order.photos || order.photos.length === 0) {
      toast({
        title: "Ошибка",
        description: "Пожалуйста, загрузите фотографии и выберите пакет шаблонов",
        variant: "destructive",
      });
      return;
    }

    setIsGenerating(true);

    try {
      const functionName = useAsyncMode ? 'generateImagesAsync' : 'generateImages';
      const response = await base44.functions.invoke(functionName, { orderId });

      if (response.data.success) {
        queryClient.invalidateQueries({ queryKey: ['order', orderId] });

        if (useAsyncMode) {
          // Запускаем polling для асинхронного режима
          startPolling();
        }
      } else {
        toast({
          title: "Ошибка генерации",
          description: extractResponseError(response.data, 'Не удалось запустить генерацию'),
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Ошибка генерации",
        description: extractErrorMessage(error, 'Не удалось запустить генерацию'),
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  // useEffect для установки выбранной фотографии
  useEffect(() => {
    if (order) {
      // Если в заказе уже есть выбранная фотография, устанавливаем ее
      if (order.selected_photo_for_album_preview) {
        setSelectedPhotoForAlbumPreview(order.selected_photo_for_album_preview);
      } else if (order.generated_images && order.generated_images.length > 0) {
        // Иначе выбираем первое сгенерированное изображение
        const firstGeneratedImage = order.generated_images.find(img => 
          img.status === 'generated' || img.status === 'approved'
        );
        if (firstGeneratedImage && firstGeneratedImage.image_url) {
          setSelectedPhotoForAlbumPreview(firstGeneratedImage.image_url);
        }
      }
    }
  }, [order]);

  // Polling для проверки статуса генерации в асинхронном режиме
  useEffect(() => {
    if (!order || !useAsyncMode) return;

    // Проверяем наличие изображений, которые нужно отслеживать:
    // - generating: активная генерация
    // - pending: в очереди
    // - failed: могла быть временная ошибка (429 и т.д.), пробуем повторно
    const hasImagesToCheck = order.generated_images?.some(
      img => (img.status === 'generating' || img.status === 'pending' || img.status === 'failed') && img.async_task_id
    );
    
    if (!hasImagesToCheck) return;

    console.log('Запуск polling для проверки статуса генерации');
    
    const checkStatus = async () => {
      try {
        console.log('Проверка статуса генерации...');
        await base44.functions.invoke('checkGenerationStatus', { orderId });
        queryClient.invalidateQueries({ queryKey: ['order', orderId] });
      } catch (error) {
        console.error('Ошибка проверки статуса:', error);
      }
    };
    
    // Первая проверка сразу
    checkStatus();
    
    // Запускаем регулярный опрос каждые 5 секунд
    const intervalId = setInterval(checkStatus, 5000);
    
    // Очищаем интервал при размонтировании или изменении зависимостей
    return () => {
      console.log('Остановка polling');
      clearInterval(intervalId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.generated_images, useAsyncMode, orderId]);

  const startPolling = () => {
    // Эта функция больше не нужна, т.к. polling запускается автоматически в useEffect
    // Оставляем её для обратной совместимости с handleStartGeneration
    console.log('startPolling вызван (polling уже работает через useEffect)');
  };

  // Принудительная проверка статуса генерации
  const handleForceCheckStatus = async () => {
    setIsCheckingStatus(true);
    try {
      console.log('Принудительная проверка статуса...');
      await base44.functions.invoke('checkGenerationStatus', { orderId });
      queryClient.invalidateQueries({ queryKey: ['order', orderId] });
    } catch (error) {
      console.error('Ошибка проверки статуса:', error);
      toast({
        title: "Ошибка проверки статуса",
        description: extractErrorMessage(error, 'Не удалось проверить статус генерации'),
        variant: "destructive",
      });
    } finally {
      setIsCheckingStatus(false);
    }
  };

  // Обработчик изменения режима генерации
  const handleModeChange = (checked) => {
    setUseAsyncMode(checked);
    localStorage.setItem('generation_mode', checked ? 'async' : 'sync');
  };

  const handleRegenerate = async (imageId) => {
    setRegeneratingIds(prev => [...prev, imageId]);

    try {
      const functionName = useAsyncMode ? 'regenerateImageAsync' : 'regenerateImage';
      const response = await base44.functions.invoke(functionName, { orderId, imageId });

      if (response.data.success) {
        queryClient.invalidateQueries({ queryKey: ['order', orderId] });

        if (useAsyncMode) {
          // В асинхронном режиме не снимаем флаг регенерации сразу
          // Он будет снят когда статус обновится через polling
        } else {
          setRegeneratingIds(prev => prev.filter(id => id !== imageId));
        }
      } else {
        toast({
          title: "Ошибка перегенерации",
          description: extractResponseError(response.data, 'Не удалось перегенерировать изображение'),
          variant: "destructive",
        });
        setRegeneratingIds(prev => prev.filter(id => id !== imageId));
      }
    } catch (error) {
      toast({
        title: "Ошибка перегенерации",
        description: extractErrorMessage(error, 'Не удалось перегенерировать изображение'),
        variant: "destructive",
      });
      setRegeneratingIds(prev => prev.filter(id => id !== imageId));
    }
  };

  const handleDelete = async (imageId) => {
    const updatedImages = order.generated_images.map(img =>
      img.id === imageId ? { ...img, status: 'deleted' } : img
    );

    await updateOrderMutation.mutateAsync({
      id: orderId,
      data: { generated_images: updatedImages }
    });
  };

  const handleApprove = async (imageId) => {
    const updatedImages = order.generated_images.map(img =>
      img.id === imageId ? { ...img, status: 'approved' } : img
    );

    await updateOrderMutation.mutateAsync({
      id: orderId,
      data: { generated_images: updatedImages }
    });
  };

  const handleCancelGeneration = async () => {
    const hasGeneratedImages = order.generated_images?.some(img => img.status === 'generated' || img.status === 'approved');
    
    const message = hasGeneratedImages 
      ? 'Вы уверены, что хотите отменить генерацию? Все сгенерированные изображения будут удалены, и заказ вернётся в статус "Черновик".'
      : 'Отменить генерацию и вернуть заказ в статус "Черновик"?';
    
    if (confirm(message)) {
      await updateOrderMutation.mutateAsync({
        id: orderId,
        data: { 
          status: 'draft',
          progress: 0,
          generated_images: []
        }
      });
    }
  };

  const handleFinishAndArchive = async () => {
    try {
      const response = await base44.functions.invoke('createArchive', { orderId });

      if (response.data.success) {
        queryClient.invalidateQueries({ queryKey: ['order', orderId] });
        toast({
          title: "Архив создан",
          description: `Успешно добавлено ${response.data.images_count} изображений`,
        });
      } else {
        toast({
          title: "Ошибка создания архива",
          description: extractResponseError(response.data, 'Не удалось создать архив'),
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Ошибка создания архива",
        description: extractErrorMessage(error, 'Не удалось создать архив'),
        variant: "destructive",
      });
    }
  };

  const handleCopyArchiveLink = async () => {
    if (!order.archive_url) {
      toast({
        title: "Ошибка",
        description: "Архив еще не создан",
        variant: "destructive",
      });
      return;
    }

    setIsCopying(true);
    try {
      const message = await generateArchiveMessage(order);
      
      // Копируем в буфер обмена
      await navigator.clipboard.writeText(message);
      
      toast({
        title: "Скопировано",
        description: "Приветственное сообщение со ссылкой на архив скопировано в буфер обмена",
      });
    } catch (error) {
      console.error('Ошибка копирования:', error);
      toast({
        title: "Ошибка",
        description: "Не удалось скопировать сообщение: " + error.message,
        variant: "destructive",
      });
    } finally {
      setIsCopying(false);
    }
  };

  const handleCreatePreview = async () => {
    if (!order.generated_images || order.generated_images.length === 0) {
      toast({
        title: "Ошибка",
        description: "Нет сгенерированных изображений для создания превью",
        variant: "destructive",
      });
      return;
    }

    setIsCreatingPreview(true);
    try {
      const response = await base44.functions.invoke('createOrderPreview', { orderId });
      
      if (response.data.success) {
        queryClient.invalidateQueries({ queryKey: ['order', orderId] });
        toast({
          title: "Успешно",
          description: `Превью создано! Создано ${response.data.images_count} миниатюр.`,
        });
      } else {
        toast({
          title: "Ошибка",
          description: "Ошибка создания превью: " + (response.data.error || 'Неизвестная ошибка'),
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Ошибка",
        description: "Ошибка создания превью: " + error.message,
        variant: "destructive",
      });
    } finally {
      setIsCreatingPreview(false);
    }
  };

  const handleRegeneratePreview = async () => {
    await handleCreatePreview();
  };

  const handleSendPreview = async () => {
    if (!order.preview_url) {
      toast({
        title: "Ошибка",
        description: "Превью еще не создано",
        variant: "destructive",
      });
      return;
    }

    setIsSendingPreview(true);
    try {
      const message = `Здравствуйте!\n\nПревью вашего заказа готово для проверки:\n\n${order.preview_url}\n\nПожалуйста, проверьте изображения и сообщите, если нужны какие-либо изменения.`;
      
      // Копируем в буфер обмена
      await navigator.clipboard.writeText(message);
      
      toast({
        title: "Скопировано",
        description: "Сообщение со ссылкой на превью скопировано в буфер обмена",
      });
    } catch (error) {
      console.error('Ошибка копирования:', error);
      toast({
        title: "Ошибка",
        description: "Не удалось скопировать сообщение: " + error.message,
        variant: "destructive",
      });
    } finally {
      setIsSendingPreview(false);
    }
  };

  const handleGenerateAlbumPreview = async () => {
    if (!selectedPhotoForAlbumPreview) {
      toast({
        title: "Ошибка",
        description: "Пожалуйста, выберите фотографию для генерации превью альбома",
        variant: "destructive",
      });
      return;
    }

    if (!selectedPackage?.album_preview_template?.prompt) {
      toast({
        title: "Ошибка",
        description: "Шаблон для генерации превью альбома не настроен",
        variant: "destructive",
      });
      return;
    }

    setIsGeneratingAlbumPreview(true);
    try {
      // Заменяем переменные в промпте
      const prompt = selectedPackage.album_preview_template.prompt
        .replace(/\[имя\]/g, order.baby_name || '')
        .replace(/\[вес\]/g, order.baby_weight ? `${order.baby_weight} kg` : '')
        .replace(/\[рост\]/g, order.baby_height ? `${order.baby_height} cm` : '')
        .replace(/\[дата\]/g, order.birth_date || '')
        .replace(/\[время\]/g, order.birth_time || '');

      const response = await base44.functions.invoke('generateAlbumPreview', {
        orderId,
        photoUrl: selectedPhotoForAlbumPreview,
        prompt
      });

      if (response.data.success && response.data.album_preview_image) {
        queryClient.invalidateQueries({ queryKey: ['order', orderId] });
        toast({
          title: "Успешно",
          description: "Превью напечатанного альбома создано!",
        });
      } else {
        toast({
          title: "Ошибка",
          description: "Ошибка создания превью альбома: " + (response.data.error || 'Неизвестная ошибка'),
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Ошибка",
        description: "Ошибка создания превью альбома: " + error.message,
        variant: "destructive",
      });
    } finally {
      setIsGeneratingAlbumPreview(false);
    }
  };

  const handleSelectPhotoForAlbumPreview = async (photoUrl) => {
    setSelectedPhotoForAlbumPreview(photoUrl);
    
    try {
      await updateOrderMutation.mutateAsync({
        id: orderId,
        data: { selected_photo_for_album_preview: photoUrl }
      });
      
      toast({
        title: "Сохранено",
        description: "Фотография для превью альбома выбрана",
      });
    } catch (error) {
      toast({
        title: "Ошибка",
        description: "Не удалось сохранить выбор фотографии: " + error.message,
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-slate-900 mb-2">Заказ не найден</h2>
          <Link to={createPageUrl('Orders')}>
            <Button variant="outline">Вернуться к заказам</Button>
          </Link>
        </div>
      </div>
    );
  }

  const statusConfig = {
    draft: { label: "Черновик", color: "bg-slate-100 text-slate-700" },
    pending: { label: "Ожидает", color: "bg-amber-100 text-amber-700" },
    processing: { label: "Генерация", color: "bg-blue-100 text-blue-700" },
    review: { label: "На проверке", color: "bg-purple-100 text-purple-700" },
    completed: { label: "Готов", color: "bg-emerald-100 text-emerald-700" },
    archived: { label: "В архиве", color: "bg-gray-100 text-gray-600" }
  };

  const status = statusConfig[order.status] || statusConfig.draft;

  if (isEditing) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50">
        <div className="max-w-5xl mx-auto px-4 py-8">
          <div className="mb-6">
            <Button variant="ghost" className="gap-2 mb-4 -ml-2" onClick={() => setIsEditing(false)}>
              <ArrowLeft className="w-4 h-4" />
              Назад к заказу
            </Button>
            <h1 className="text-3xl font-bold text-slate-900 mb-2">
              Редактирование заказа #{order.order_number}
            </h1>
          </div>

          <OrderForm 
            order={order}
            packages={packages}
            onSave={handleSave}
            onCancel={() => setIsEditing(false)}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-6">
          <Link to={createPageUrl('Orders')}>
            <Button variant="ghost" className="gap-2 mb-4 -ml-2">
              <ArrowLeft className="w-4 h-4" />
              Назад к заказам
            </Button>
          </Link>
          
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-3xl font-bold text-slate-900">
                  Заказ #{order.order_number}
                </h1>
                <Badge className={`${status.color} border-0`}>
                  {status.label}
                </Badge>
              </div>
              <p className="text-slate-600">{order.mother_name}</p>
            </div>
            
            <div className="flex gap-2 flex-wrap items-center">
              {order.status === 'draft' && order.photos?.length > 0 && order.template_package_id && (
                <div className="flex items-center gap-2 px-3 py-2 bg-slate-100 rounded-lg">
                  <Label htmlFor="async-mode" className="text-sm cursor-pointer flex items-center gap-1.5">
                    {useAsyncMode ? <Zap className="w-4 h-4 text-blue-600" /> : <Sparkles className="w-4 h-4 text-purple-600" />}
                    {useAsyncMode ? 'Параллельная генерация' : 'Обычный режим'}
                  </Label>
                  <Switch 
                    id="async-mode"
                    checked={useAsyncMode}
                    onCheckedChange={handleModeChange}
                  />
                </div>
              )}
              
              <Button variant="outline" onClick={() => setIsEditing(true)}>
                <Edit className="w-4 h-4 mr-2" />
                Редактировать
              </Button>
              
              {/* Кнопка для принудительной проверки статуса */}
              {useAsyncMode && (
                <Button 
                  variant="outline"
                  className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                  onClick={handleForceCheckStatus}
                  disabled={isCheckingStatus}
                >
                  {isCheckingStatus ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Проверка...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Обновить статус
                    </>
                  )}
                </Button>
              )}
              
              {(order.status !== 'completed' && order.status !== 'archived') && (
                <Button 
                  variant="outline"
                  className="text-red-600 hover:text-red-700 hover:bg-red-50"
                  onClick={handleCancelGeneration}
                >
                  <XCircle className="w-4 h-4 mr-2" />
                  Отменить генерацию
                </Button>
              )}
              {order.status === 'draft' && order.photos?.length > 0 && order.template_package_id && (
                <Button 
                  className={useAsyncMode ? "bg-blue-600 hover:bg-blue-700" : "bg-purple-600 hover:bg-purple-700"}
                  onClick={handleStartGeneration}
                  disabled={isGenerating}
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Запуск...
                    </>
                  ) : (
                    <>
                      {useAsyncMode ? <Zap className="w-4 h-4 mr-2" /> : <Sparkles className="w-4 h-4 mr-2" />}
                      Начать генерацию
                    </>
                  )}
                </Button>
              )}
              {order.status === 'review' && (
                <Button 
                  className="bg-emerald-600 hover:bg-emerald-700"
                  onClick={handleFinishAndArchive}
                >
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  Завершить и создать архив
                </Button>
              )}
              {/* Кнопки для работы с превью */}
              {order.generated_images && order.generated_images.length > 0 && 
               (order.status === 'review' || order.status === 'completed') && (
                <>
                  {(!order.preview_images || order.preview_images.length === 0) ? (
                    <Button 
                      variant="outline"
                      onClick={handleCreatePreview}
                      disabled={isCreatingPreview}
                      className="border-blue-300 text-blue-700 hover:bg-blue-50"
                    >
                      {isCreatingPreview ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Создание...
                        </>
                      ) : (
                        <>
                          <Eye className="w-4 h-4 mr-2" />
                          Создать превью
                        </>
                      )}
                    </Button>
                  ) : (
                    <>
                      <Button 
                        variant="outline"
                        onClick={handleRegeneratePreview}
                        disabled={isCreatingPreview}
                        className="border-blue-300 text-blue-700 hover:bg-blue-50"
                      >
                        {isCreatingPreview ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Перегенерация...
                          </>
                        ) : (
                          <>
                            <RefreshCw className="w-4 h-4 mr-2" />
                            Перегенерировать превью
                          </>
                        )}
                      </Button>
                      <Button 
                        variant="outline"
                        onClick={handleSendPreview}
                        disabled={isSendingPreview}
                        className="border-green-300 text-green-700 hover:bg-green-50"
                      >
                        {isSendingPreview ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Копирование...
                          </>
                        ) : (
                          <>
                            <Send className="w-4 h-4 mr-2" />
                            Отправить превью
                          </>
                        )}
                      </Button>
                    </>
                  )}
                </>
              )}
              {order.status === 'completed' && order.archive_url && (
                <>
                  <Button 
                    variant="outline"
                    onClick={handleCopyArchiveLink}
                    disabled={isCopying}
                    className="border-slate-300"
                  >
                    {isCopying ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Копирование...
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4 mr-2" />
                        Скопировать ссылку на архив
                      </>
                    )}
                  </Button>
                  <a href={order.archive_url} download target="_blank" rel="noopener noreferrer">
                    <Button className="bg-slate-900 hover:bg-slate-800">
                      <Download className="w-4 h-4 mr-2" />
                      Скачать архив
                    </Button>
                  </a>
                </>
              )}
            </div>
          </div>
        </div>

        <Tabs defaultValue="info" className="space-y-6">
          <TabsList>
            <TabsTrigger value="info">Информация</TabsTrigger>
            <TabsTrigger value="photos">Фотографии ({order.photos?.length || 0})</TabsTrigger>
            <TabsTrigger value="generation">
              Генерация {order.generated_images?.length > 0 && `(${order.generated_images.filter(i => i.status !== 'deleted').length})`}
            </TabsTrigger>
            <TabsTrigger value="album">Альбом</TabsTrigger>
          </TabsList>

          <TabsContent value="info">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card className="border-slate-200">
                <CardHeader>
                  <CardTitle className="text-lg">Данные мамы</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <div className="text-sm text-slate-500 mb-1">Имя</div>
                    <div className="font-medium">{order.mother_name}</div>
                  </div>
                  <div>
                    <div className="text-sm text-slate-500 mb-1 flex items-center gap-2">
                      <Phone className="w-3.5 h-3.5" />
                      Телефон
                    </div>
                    <div className="font-medium">{order.mother_phone}</div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-slate-200">
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Baby className="w-5 h-5" />
                    Данные ребёнка
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {order.baby_name && (
                    <div>
                      <div className="text-sm text-slate-500 mb-1">Имя</div>
                      <div className="font-medium">{order.baby_name}</div>
                    </div>
                  )}
                  <div>
                    <div className="text-sm text-slate-500 mb-1">Пол</div>
                    <div className="font-medium">
                      {order.baby_gender === 'boy' ? 'Мальчик' : 'Девочка'}
                    </div>
                  </div>
                  {(order.baby_weight || order.baby_height) && (
                    <div className="flex gap-4">
                      {order.baby_weight && (
                        <div>
                          <div className="text-sm text-slate-500 mb-1">Вес</div>
                          <div className="font-medium">{order.baby_weight} кг</div>
                        </div>
                      )}
                      {order.baby_height && (
                        <div>
                          <div className="text-sm text-slate-500 mb-1">Рост</div>
                          <div className="font-medium">{order.baby_height} см</div>
                        </div>
                      )}
                    </div>
                  )}
                  {order.birth_date && (
                    <div>
                      <div className="text-sm text-slate-500 mb-1 flex items-center gap-2">
                        <Calendar className="w-3.5 h-3.5" />
                        Дата рождения
                      </div>
                      <div className="font-medium">
                        {format(new Date(order.birth_date), "d MMMM yyyy", { locale: ru })}
                        {order.birth_time && (
                          <span className="ml-2 text-slate-500">
                            <Clock className="w-3.5 h-3.5 inline mr-1" />
                            {order.birth_time}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {selectedPackage && (
                <Card className="border-slate-200 md:col-span-2">
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Package className="w-5 h-5" />
                      Пакет шаблонов
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="font-semibold text-lg">{selectedPackage.name}</h3>
                        <p className="text-slate-600 text-sm mt-1">{selectedPackage.description}</p>
                        <div className="mt-3 text-sm text-slate-500">
                          {selectedPackage.templates?.length || 0} шаблонов
                        </div>
                      </div>
                      <Badge variant="outline">
                        {selectedPackage.gender === 'boy' ? 'Мальчик' : selectedPackage.gender === 'girl' ? 'Девочка' : 'Универсальный'}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              )}

              {order.notes && (
                <Card className="border-slate-200 md:col-span-2">
                  <CardHeader>
                    <CardTitle className="text-lg">Заметки</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-slate-700">{order.notes}</p>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          <TabsContent value="photos">
            {order.photos && order.photos.length > 0 ? (
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {order.photos.map((photo, index) => (
                  <div key={index} className="aspect-square rounded-lg overflow-hidden border border-slate-200">
                    <img src={photo} alt={`Фото ${index + 1}`} className="w-full h-full object-cover" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-slate-500">
                Фотографии не загружены
              </div>
            )}
          </TabsContent>

          <TabsContent value="generation">
            {order.status === 'draft' ? (
              <div className="text-center py-12">
                <Sparkles className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-slate-900 mb-2">
                  Генерация не запущена
                </h3>
                <p className="text-slate-600 mb-6">
                  Загрузите фотографии и выберите пакет шаблонов, чтобы начать генерацию
                </p>
                {order.photos?.length > 0 && order.template_package_id && (
                  <Button 
                    className="bg-purple-600 hover:bg-purple-700"
                    onClick={handleStartGeneration}
                    disabled={isGenerating}
                  >
                    {isGenerating ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Запуск...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4 mr-2" />
                        Начать генерацию
                      </>
                    )}
                  </Button>
                )}
              </div>
            ) : (
              <GenerationGallery
                images={order.generated_images || []}
                onRegenerate={handleRegenerate}
                onDelete={handleDelete}
                onApprove={handleApprove}
                regeneratingIds={regeneratingIds}
                readOnly={order.status === 'completed' || order.status === 'archived'}
              />
            )}
          </TabsContent>

          <TabsContent value="album">
            <Card className="border-slate-200">
              <CardHeader>
                <CardTitle className="text-lg">Превью напечатанного альбома</CardTitle>
                <p className="text-sm text-slate-600 mt-1">
                  Выберите фотографию для генерации превью напечатанного альбома
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                {order.generated_images && order.generated_images.filter(i => i.status !== 'deleted').length > 0 ? (
                  <>
                    <div className="space-y-3">
                      <Label>Выбранная фотография для превью:</Label>
                      {selectedPhotoForAlbumPreview ? (
                        <div className="relative inline-block">
                          <div className="w-48 h-48 rounded-lg overflow-hidden border-2 border-slate-200">
                            <img 
                              src={selectedPhotoForAlbumPreview} 
                              alt="Выбранная фотография" 
                              className="w-full h-full object-cover"
                            />
                          </div>
                          <div className="mt-2 p-2 bg-green-50 border border-green-200 rounded">
                            <div className="flex items-center gap-2 text-green-700">
                              <CheckCircle2 className="w-4 h-4" />
                              <span className="text-sm">Выбрано</span>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="text-sm text-slate-500">Не выбрано</div>
                      )}
                    </div>

                    <div className="space-y-3">
                      <Label>Доступные фотографии (кликните для выбора):</Label>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {order.generated_images
                          .filter(img => img.status !== 'deleted' && (img.status === 'generated' || img.status === 'approved') && img.image_url)
                          .map((image, index) => (
                            <div 
                              key={image.id} 
                              className={`relative cursor-pointer rounded-lg overflow-hidden border-2 ${
                                selectedPhotoForAlbumPreview === image.image_url 
                                  ? 'border-blue-500' 
                                  : 'border-slate-200 hover:border-slate-300'
                              }`}
                              onClick={() => handleSelectPhotoForAlbumPreview(image.image_url)}
                            >
                              <img 
                                src={image.image_url} 
                                alt={`Фотография ${index + 1}`} 
                                className="w-full h-full object-cover"
                              />
                              {selectedPhotoForAlbumPreview === image.image_url && (
                                <div className="absolute top-2 right-2 bg-blue-500 text-white rounded-full p-1">
                                  <CheckCircle2 className="w-3 h-3" />
                                </div>
                              )}
                            </div>
                          ))
                        }
                      </div>
                    </div>

                    {order.album_preview_image && (
                      <div className="space-y-3">
                        <Label>Сгенерированное превью альбома:</Label>
                        <div className="relative inline-block">
                          <div className="w-64 h-auto rounded-lg overflow-hidden border-2 border-slate-200">
                            <img 
                              src={order.album_preview_image} 
                              alt="Превью альбома" 
                              className="w-full h-auto object-cover"
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="flex gap-3">
                      <Button
                        onClick={handleGenerateAlbumPreview}
                        disabled={!selectedPhotoForAlbumPreview || !selectedPackage?.album_preview_template?.prompt || isGeneratingAlbumPreview}
                        className="bg-blue-600 hover:bg-blue-700"
                      >
                        {isGeneratingAlbumPreview ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Генерация...
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-4 h-4 mr-2" />
                            Сгенерировать превью альбома
                          </>
                        )}
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="text-center py-12 text-slate-500">
                    Нет доступных фотографий для создания превью альбома
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}