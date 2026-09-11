import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

type AnimatedPillNavProps = {
  activeKey?: string;
  layoutKey?: string;
  as?: 'div' | 'nav';
  className?: string;
  ariaLabel?: string;
  children: ReactNode;
};

type IndicatorState = {
  visible: boolean;
};

type IndicatorMotion = {
  frame: number | null;
  left: number;
  width: number;
  velocityLeft: number;
  velocityWidth: number;
  initialized: boolean;
};

/**
 * 公共顶栏选中胶囊：内容项保持原位，只让活动背景层沿导航轨道移动。
 * 这样首页项目导航和客户端业务导航使用同一套位移与响应式逻辑。
 */
export function AnimatedPillNav({
  activeKey,
  layoutKey = '',
  as = 'div',
  className,
  ariaLabel,
  children,
}: AnimatedPillNavProps) {
  const navigationRef = useRef<HTMLElement | null>(null);
  const indicatorRef = useRef<HTMLSpanElement | null>(null);
  const motionRef = useRef<IndicatorMotion>({
    frame: null,
    left: 0,
    width: 0,
    velocityLeft: 0,
    velocityWidth: 0,
    initialized: false,
  });
  const [indicator, setIndicator] = useState<IndicatorState>({ visible: false });
  const setNavigationRef = (node: HTMLElement | null) => {
    navigationRef.current = node;
  };

  useLayoutEffect(() => {
    const navigation = navigationRef.current;
    const motion = motionRef.current;

    function stopAnimation() {
      if (motion.frame !== null) {
        cancelAnimationFrame(motion.frame);
        motion.frame = null;
      }
    }

    function applyIndicator() {
      const indicatorElement = indicatorRef.current;
      if (!indicatorElement) return;
      indicatorElement.style.width = `${Math.max(0, motion.width)}px`;
      indicatorElement.style.transform = `translate3d(${motion.left}px, 0, 0)`;
    }

    if (!navigation || !activeKey) {
      stopAnimation();
      motion.initialized = false;
      setIndicator((current) => (current.visible ? { visible: false } : current));
      return;
    }

    const marker = Array.from(navigation.querySelectorAll<HTMLElement>('[data-animated-pill-item]')).find(
      (item) => item.dataset.animatedPillItem === activeKey,
    );
    const item = marker?.closest<HTMLElement>('.ant-menu-item, .ant-menu-submenu') ?? marker;

    if (!item) {
      stopAnimation();
      motion.initialized = false;
      setIndicator((current) => (current.visible ? { visible: false } : current));
      return;
    }

    function moveIndicator(left: number, width: number, animate: boolean) {
      const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      stopAnimation();

      if (!motion.initialized || !animate || reducedMotion) {
        motion.left = left;
        motion.width = width;
        motion.velocityLeft = 0;
        motion.velocityWidth = 0;
        motion.initialized = true;
        applyIndicator();
        return;
      }

      const targetLeft = left;
      const targetWidth = width;
      let previousTime: number | null = null;
      const stiffness = 220;
      const damping = 2 * Math.sqrt(stiffness);

      const step = (time: number) => {
        const deltaTime = Math.min((time - (previousTime ?? time)) / 1000 || 1 / 60, 0.032);
        previousTime = time;

        motion.velocityLeft += (targetLeft - motion.left) * stiffness * deltaTime;
        motion.velocityLeft -= motion.velocityLeft * damping * deltaTime;
        motion.left += motion.velocityLeft * deltaTime;
        motion.velocityWidth += (targetWidth - motion.width) * stiffness * deltaTime;
        motion.velocityWidth -= motion.velocityWidth * damping * deltaTime;
        motion.width += motion.velocityWidth * deltaTime;
        applyIndicator();

        const settled =
          Math.abs(targetLeft - motion.left) < 0.1 &&
          Math.abs(targetWidth - motion.width) < 0.1 &&
          Math.abs(motion.velocityLeft) < 0.1 &&
          Math.abs(motion.velocityWidth) < 0.1;

        if (settled) {
          motion.left = targetLeft;
          motion.width = targetWidth;
          motion.velocityLeft = 0;
          motion.velocityWidth = 0;
          motion.frame = null;
          applyIndicator();
          return;
        }

        motion.frame = requestAnimationFrame(step);
      };

      motion.frame = requestAnimationFrame(step);
    }

    const updateIndicator = (animate: boolean) => {
      const navigationRect = navigation.getBoundingClientRect();
      const itemRect = item.getBoundingClientRect();
      moveIndicator(itemRect.left - navigationRect.left, itemRect.width, animate);
      setIndicator((current) => (current.visible ? current : { visible: true }));
    };

    const handleScroll = () => updateIndicator(false);
    const handleResize = () => updateIndicator(false);
    updateIndicator(true);
    navigation.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleResize);

    const resizeObserver =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => updateIndicator(false)) : null;
    resizeObserver?.observe(navigation);
    resizeObserver?.observe(item);

    return () => {
      stopAnimation();
      navigation.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleResize);
      resizeObserver?.disconnect();
    };
  }, [activeKey, layoutKey]);

  const content = (
    <>
      <span
        ref={indicatorRef}
        className={`animated-pill-nav__indicator ${indicator.visible ? 'is-visible' : ''}`}
        aria-hidden="true"
      />
      {children}
    </>
  );

  const containerClassName = `animated-pill-nav ${className ?? ''}`.trim();
  return as === 'nav' ? (
    <nav ref={setNavigationRef} className={containerClassName} aria-label={ariaLabel}>
      {content}
    </nav>
  ) : (
    <div ref={setNavigationRef} className={containerClassName} aria-label={ariaLabel}>
      {content}
    </div>
  );
}
