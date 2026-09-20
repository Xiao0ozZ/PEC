import { usePlatformTheme } from '@/features/theme/platform-theme';

type PlatformBrandVariant = 'full' | 'mark';

const brandAsset = (fileName: string) => `${import.meta.env.BASE_URL}brand/${fileName}`;

export function PlatformBrand({
  variant = 'mark',
  alt = '产品功能体验中心',
  className,
}: {
  variant?: PlatformBrandVariant;
  alt?: string;
  className?: string;
}) {
  const { resolvedMode } = usePlatformTheme();
  const fileName =
    variant === 'full'
      ? `logo-horizontal-cn${resolvedMode === 'dark' ? '-white' : ''}.svg`
      : 'icon-sidebar.svg';

  return (
    <img
      className={`platform-brand platform-brand--${variant}${className ? ` ${className}` : ''}`}
      src={brandAsset(fileName)}
      alt={alt}
      draggable={false}
    />
  );
}
