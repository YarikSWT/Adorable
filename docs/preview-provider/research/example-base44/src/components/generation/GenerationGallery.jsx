import React from 'react';
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { RefreshCw, Trash2, Check, Loader2, Download, AlertCircle } from "lucide-react";

const statusConfig = {
  pending: { label: "Ожидает", color: "bg-amber-100 text-amber-700" },
  generating: { label: "Генерация", color: "bg-blue-100 text-blue-700" },
  generated: { label: "Готово", color: "bg-emerald-100 text-emerald-700" },
  regenerating: { label: "Перегенерация", color: "bg-blue-100 text-blue-700" },
  approved: { label: "Одобрено", color: "bg-green-100 text-green-700" },
  deleted: { label: "Удалено", color: "bg-red-100 text-red-700" },
  failed: { label: "Ошибка", color: "bg-red-100 text-red-700" }
};

export default function GenerationGallery({ 
  images, 
  onRegenerate, 
  onDelete, 
  onApprove,
  regeneratingIds = [],
  readOnly = false 
}) {
  const activeImages = images?.filter(img => img.status !== 'deleted') || [];

  if (activeImages.length === 0) {
    return (
      <div className="text-center py-12 text-slate-500">
        Нет сгенерированных изображений
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {activeImages.map((image) => {
        const status = statusConfig[image.status] || statusConfig.pending;
        const isRegenerating = regeneratingIds.includes(image.id);
        const hasError = image.status === 'failed' && image.error_details;
        
        const cardContent = (
          <Card 
            key={image.id} 
            className="group overflow-hidden border-slate-200 hover:border-slate-300 transition-colors"
          >
            <div className="relative aspect-[3/4] bg-slate-100">
              {image.image_url ? (
                <img 
                  src={image.image_url} 
                  alt="Generated" 
                  className="w-full h-full object-cover"
                />
              ) : image.status === 'failed' ? (
                <div className="w-full h-full flex flex-col items-center justify-center p-4 text-center">
                  <AlertCircle className="w-8 h-8 text-red-500 mb-2" />
                  <p className="text-sm font-medium text-red-600 mb-1">
                    {image.error || 'Ошибка генерации'}
                  </p>
                  {image.error_details && (
                    <div className="text-xs text-red-500 space-y-0.5 mb-2">
                      {image.error_details.status_code && (
                        <div>Статус: {image.error_details.status_code} {image.error_details.status_text}</div>
                      )}
                      {image.error_details.error_code && (
                        <div>Код ошибки: {image.error_details.error_code}</div>
                      )}
                      {image.error_details.error_type && (
                        <div>Тип: {image.error_details.error_type}</div>
                      )}
                    </div>
                  )}
                  {!readOnly && (
                    <Button size="sm" variant="outline" onClick={() => onRegenerate(image.id)}>
                      <RefreshCw className="w-3 h-3 mr-1" />
                      Повторить
                    </Button>
                  )}
                </div>
              ) : image.status === 'generating' ? (
                <div className="w-full h-full flex flex-col items-center justify-center p-4">
                  <Loader2 className="w-8 h-8 text-blue-500 animate-spin mb-3" />
                  <div className="w-full px-4">
                    <Progress value={image.progress || 0} className="h-2 mb-2" />
                    <p className="text-xs text-center text-slate-600">
                      {image.progress || 0}%
                    </p>
                  </div>
                </div>
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Loader2 className="w-8 h-8 text-slate-400 animate-spin" />
                </div>
              )}
              
              {/* Status badge */}
              <div className="absolute top-2 left-2">
                <Badge className={`${status.color} border-0 text-[10px]`}>
                  {isRegenerating ? 'Генерация...' : status.label}
                </Badge>
              </div>

              {/* Actions overlay */}
              {!readOnly && image.image_url && (
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                  {image.status !== 'approved' && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => onApprove(image.id)}
                      className="bg-white/90 hover:bg-white"
                    >
                      <Check className="w-4 h-4" />
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => onRegenerate(image.id)}
                    disabled={isRegenerating}
                    className="bg-white/90 hover:bg-white"
                  >
                    {isRegenerating ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <RefreshCw className="w-4 h-4" />
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => onDelete(image.id)}
                    className="bg-white/90 hover:bg-white text-red-600 hover:text-red-700"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                  <a 
                    href={image.image_url} 
                    download 
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Button
                      size="sm"
                      variant="secondary"
                      className="bg-white/90 hover:bg-white"
                    >
                      <Download className="w-4 h-4" />
                    </Button>
                  </a>
                </div>
              )}
            </div>
          </Card>
        );
        
        if (hasError) {
          return (
            <Tooltip key={image.id}>
              <TooltipTrigger asChild>
                {cardContent}
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-sm p-3 bg-slate-900 text-white">
                <div className="space-y-2">
                  <div className="font-semibold text-sm border-b border-slate-700 pb-1">
                    Детали ошибки
                  </div>
                  {image.error && (
                    <div>
                      <span className="text-xs text-slate-400">Описание:</span>
                      <div className="text-sm">{image.error}</div>
                    </div>
                  )}
                  {image.error_details.status_code !== 0 && (
                    <div>
                      <span className="text-xs text-slate-400">HTTP статус:</span>
                      <div className="text-sm font-mono">
                        {image.error_details.status_code} {image.error_details.status_text}
                      </div>
                    </div>
                  )}
                  {image.error_details.error_code && (
                    <div>
                      <span className="text-xs text-slate-400">Код ошибки:</span>
                      <div className="text-sm font-mono">{image.error_details.error_code}</div>
                    </div>
                  )}
                  {image.error_details.error_message && image.error_details.error_message !== image.error && (
                    <div>
                      <span className="text-xs text-slate-400">Сообщение:</span>
                      <div className="text-sm">{image.error_details.error_message}</div>
                    </div>
                  )}
                  {image.error_details.timestamp && (
                    <div>
                      <span className="text-xs text-slate-400">Время:</span>
                      <div className="text-xs font-mono">{new Date(image.error_details.timestamp).toLocaleString('ru-RU')}</div>
                    </div>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>
          );
        }
        
        return cardContent;
      })}
      </div>
    </TooltipProvider>
  );
}