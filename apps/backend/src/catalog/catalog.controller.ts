import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { CatalogService } from './catalog.service';

@Controller('plans')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}
  @Get() async all() { return { data: await this.catalog.all(), meta: { quota_enforcement: false, provider: 'aws' } }; }
  @Get(':slug') async one(@Param('slug') slug: string) {
    const plan = await this.catalog.one(slug);
    if (!plan) throw new NotFoundException('Plan no encontrado.');
    return { data: plan };
  }
}
