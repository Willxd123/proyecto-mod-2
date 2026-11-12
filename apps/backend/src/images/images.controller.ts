import { Controller, Get, Query, ServiceUnavailableException } from '@nestjs/common';
import { SERVER_ROLES } from '@modulo2/contracts';
import { ImagesService } from './images.service';

@Controller('golden-images')
export class ImagesController {
  constructor(private readonly images: ImagesService) {}
  @Get() async list(@Query('region') region?: string) {
    try {
      const data = await this.images.list(region);
      return { data, meta: { ready: Object.fromEntries(SERVER_ROLES.map(role => [role, data.some(image => image.role === role)])) } };
    } catch { throw new ServiceUnavailableException('No se pudo leer el registro de imágenes.'); }
  }
}
