// Entrada de ratón/teclado con pointer lock. Pide movimiento "unadjusted"
// (sin aceleración del SO) cuando el navegador lo permite.
export class Input {
  constructor(element, settings) {
    this.element = element;
    this.settings = settings;
    this.locked = false;
    this.rawMovement = false;
    this.onLockChange = () => {};

    this.dx = 0;
    this.dy = 0;
    this.fire = false;
    this.firePressed = false;
    this.ads = false;
    this.keys = new Set();

    this.moveEvent = null;
    this.onMove = (e) => {
      if (!this.locked) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
    };
    this.bindMoveEvent();

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.element;
      if (!this.locked) this.releaseAll();
      this.onLockChange(this.locked);
    });

    document.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) {
        this.fire = true;
        this.firePressed = true;
      } else if (e.button === 2) {
        this.ads = this.settings.adsMode === 'toggle' ? !this.ads : true;
      }
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.fire = false;
      else if (e.button === 2 && this.settings.adsMode === 'hold') this.ads = false;
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('keydown', (e) => {
      if (!this.locked) return;
      this.keys.add(e.code);
    });
    document.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.releaseAll());
  }

  /** Escucha pointerrawupdate o mousemove (nunca ambos, para no contar doble). */
  bindMoveEvent() {
    const wanted = this.settings.useRawUpdate && 'onpointerrawupdate' in window ? 'pointerrawupdate' : 'mousemove';
    if (wanted === this.moveEvent) return;
    if (this.moveEvent) document.removeEventListener(this.moveEvent, this.onMove);
    document.addEventListener(wanted, this.onMove);
    this.moveEvent = wanted;
  }

  async lock() {
    try {
      await this.element.requestPointerLock({ unadjustedMovement: true });
      this.rawMovement = true;
    } catch (err) {
      if (err?.name === 'NotSupportedError') {
        this.rawMovement = false;
        await this.element.requestPointerLock();
      } else {
        throw err;
      }
    }
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  consumeMouse() {
    const d = [this.dx, this.dy];
    this.dx = 0;
    this.dy = 0;
    return d;
  }

  takeFirePress() {
    const p = this.firePressed;
    this.firePressed = false;
    return p;
  }

  releaseAll() {
    this.fire = false;
    this.firePressed = false;
    this.ads = false;
    this.keys.clear();
    this.dx = 0;
    this.dy = 0;
  }
}
