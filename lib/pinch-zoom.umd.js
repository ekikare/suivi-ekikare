/**
 * PinchZoom.js (UMD)
 * Version: 2.3.5 (Enhanced for Document & Multi-Page Viewers)
 * Copyright (c) Manuel Stofer 2013 - today
 * MIT License
 */
(function (global, factory) {
    if (typeof define === "function" && define.amd) {
        define(['exports'], factory);
    } else if (typeof exports !== "undefined") {
        factory(exports);
    } else {
        var mod = { exports: {} };
        factory(mod.exports);
        var pz = mod.exports.default || mod.exports;
        global.PinchZoom = pz;
        if (typeof window !== 'undefined') {
            window.PinchZoom = pz;
        }
    }
})(typeof window !== 'undefined' ? window : this, function (exports) {
    'use strict';

    Object.defineProperty(exports, "__esModule", {
        value: true
    });

    if (typeof Object.assign !== 'function') {
        Object.defineProperty(Object, "assign", {
            value: function assign(target) {
                if (target == null) {
                    throw new TypeError('Cannot convert undefined or null to object');
                }
                var to = Object(target);
                for (var index = 1; index < arguments.length; index++) {
                    var nextSource = arguments[index];
                    if (nextSource != null) {
                        for (var nextKey in nextSource) {
                            if (Object.prototype.hasOwnProperty.call(nextSource, nextKey)) {
                                to[nextKey] = nextSource[nextKey];
                            }
                        }
                    }
                }
                return to;
            },
            writable: true,
            configurable: true
        });
    }

    if (typeof Array.from !== 'function') {
        Array.from = function (object) {
            return [].slice.call(object);
        };
    }

    var buildElement = function (str) {
        var tmp = document.implementation.createHTMLDocument('');
        tmp.body.innerHTML = str;
        return Array.from(tmp.body.children)[0];
    };

    var triggerEvent = function (el, name) {
        var event = document.createEvent('HTMLEvents');
        event.initEvent(name, true, false);
        el.dispatchEvent(event);
    };

    var sum = function (a, b) {
        return a + b;
    };

    var isCloseTo = function (value, expected) {
        return value > expected - 0.01 && value < expected + 0.01;
    };

    var definePinchZoom = function () {
        var PinchZoom = function (el, options) {
            this.el = el;
            this.zoomFactor = 1;
            this.lastScale = 1;
            this.offset = { x: 0, y: 0 };
            this.initialOffset = { x: 0, y: 0 };
            this.options = Object.assign({}, this.defaults, options);
            this.setupMarkup();
            this.bindEvents();
            this.update();

            if (this.isImageLoaded(this.el)) {
                this.updateAspectRatio();
                this.setupOffsets();
            }

            this.enable();
        };

        PinchZoom.prototype = {
            defaults: {
                tapZoomFactor: 2,
                zoomFactor: 0.8,
                zoomOutFactor: 1.0,
                animationDuration: 0,
                maxZoom: 4,
                minZoom: 1,
                draggableUnzoomed: false,
                lockDragAxis: false,
                setOffsetsOnce: true,
                preventSnapBack: true,
                use2d: true,
                fitWidth: true,
                zoomStartEventName: 'pz_zoomstart',
                zoomUpdateEventName: 'pz_zoomupdate',
                zoomEndEventName: 'pz_zoomend',
                dragStartEventName: 'pz_dragstart',
                dragUpdateEventName: 'pz_dragupdate',
                dragEndEventName: 'pz_dragend',
                doubleTapEventName: 'pz_doubletap',
                verticalPadding: 0,
                horizontalPadding: 0,
                onZoomStart: null,
                onZoomEnd: null,
                onZoomUpdate: null,
                onDragStart: null,
                onDragEnd: null,
                onDragUpdate: null,
                onDoubleTap: null
            },

            handleDragStart: function (event) {
                triggerEvent(this.el, this.options.dragStartEventName);
                if (typeof this.options.onDragStart === "function") {
                    this.options.onDragStart(this, event);
                }
                this.stopAnimation();
                this.lastDragPosition = false;
                this.hasInteraction = true;
                this.handleDrag(event);
            },

            handleDrag: function (event) {
                var touch = this.getTouches(event)[0];
                this.drag(touch, this.lastDragPosition);
                this.offset = this.sanitizeOffset(this.offset);
                this.lastDragPosition = touch;
            },

            handleDragEnd: function () {
                triggerEvent(this.el, this.options.dragEndEventName);
                if (typeof this.options.onDragEnd === "function") {
                    this.options.onDragEnd(this, event);
                }
                this.end();
            },

            handleZoomStart: function (event) {
                triggerEvent(this.el, this.options.zoomStartEventName);
                if (typeof this.options.onZoomStart === "function") {
                    this.options.onZoomStart(this, event);
                }
                this.stopAnimation();
                this.lastScale = 1;
                this.nthZoom = 0;
                this.lastZoomCenter = false;
                this.hasInteraction = true;
            },

            handleZoom: function (event, newScale) {
                var touchCenter = this.getTouchCenter(this.getTouches(event)),
                    scale = newScale / this.lastScale;
                this.lastScale = newScale;

                this.nthZoom += 1;
                if (this.nthZoom > 3) {
                    this.scale(scale, touchCenter);
                    this.drag(touchCenter, this.lastZoomCenter);
                }
                this.lastZoomCenter = touchCenter;
            },

            handleZoomEnd: function () {
                triggerEvent(this.el, this.options.zoomEndEventName);
                if (typeof this.options.onZoomEnd === "function") {
                    this.options.onZoomEnd(this, event);
                }
                this.end();
            },

            handleDoubleTap: function (event) {
                var center = this.getTouches(event)[0],
                    zoomFactor = this.zoomFactor > 1 ? 1 : this.options.tapZoomFactor,
                    startZoomFactor = this.zoomFactor,
                    updateProgress = function (progress) {
                        this.scaleTo(startZoomFactor + progress * (zoomFactor - startZoomFactor), center);
                    }.bind(this);

                if (this.hasInteraction) {
                    return;
                }

                this.isDoubleTap = true;
                if (startZoomFactor > zoomFactor) {
                    center = this.getCurrentZoomCenter();
                }

                this.animate(this.options.animationDuration, updateProgress, this.swing);
                triggerEvent(this.el, this.options.doubleTapEventName);
                if (typeof this.options.onDoubleTap === "function") {
                    this.options.onDoubleTap(this, event);
                }
            },

            computeInitialOffset: function () {
                this.initialOffset = {
                    x: -Math.abs(this.el.offsetWidth * this.getInitialZoomFactor() - this.container.offsetWidth) / 2,
                    y: -Math.abs(this.el.offsetHeight * this.getInitialZoomFactor() - this.container.offsetHeight) / 2
                };
            },

            resetOffset: function () {
                this.offset.x = this.initialOffset.x;
                this.offset.y = this.initialOffset.y;
            },

            isImageLoaded: function (el) {
                if (el.nodeName === 'IMG') {
                    return el.complete && el.naturalHeight !== 0;
                } else {
                    return Array.from(el.querySelectorAll('img')).every(this.isImageLoaded);
                }
            },

            setupOffsets: function () {
                if (this.options.setOffsetsOnce && this._isOffsetsSet) {
                    return;
                }
                this._isOffsetsSet = true;
                this.computeInitialOffset();
                this.resetOffset();
            },

            sanitizeOffset: function (offset) {
                var elWidth = this.el.offsetWidth * this.getInitialZoomFactor() * this.zoomFactor;
                var elHeight = this.el.offsetHeight * this.getInitialZoomFactor() * this.zoomFactor;
                var maxX = elWidth - this.getContainerX() + this.options.horizontalPadding,
                    maxY = elHeight - this.getContainerY() + this.options.verticalPadding,
                    maxOffsetX = Math.max(maxX, 0),
                    maxOffsetY = Math.max(maxY, 0),
                    minOffsetX = Math.min(maxX, 0) - this.options.horizontalPadding,
                    minOffsetY = Math.min(maxY, 0) - this.options.verticalPadding;

                return {
                    x: Math.min(Math.max(offset.x, minOffsetX), maxOffsetX),
                    y: Math.min(Math.max(offset.y, minOffsetY), maxOffsetY)
                };
            },

            scaleTo: function (zoomFactor, center) {
                center = center || this.getCurrentZoomCenter();
                this.scale(zoomFactor / this.zoomFactor, center);
            },

            scale: function (_scale, center) {
                center = center || this.getCurrentZoomCenter();
                _scale = this.scaleZoomFactor(_scale);
                this.addOffset({
                    x: (_scale - 1) * (center.x + this.offset.x),
                    y: (_scale - 1) * (center.y + this.offset.y)
                });
                triggerEvent(this.el, this.options.zoomUpdateEventName);
                if (typeof this.options.onZoomUpdate === "function") {
                    this.options.onZoomUpdate(this, event);
                }
            },

            scaleZoomFactor: function (scale) {
                var originalZoomFactor = this.zoomFactor;
                this.zoomFactor *= scale;
                this.zoomFactor = Math.min(this.options.maxZoom, Math.max(this.zoomFactor, this.options.minZoom));
                return this.zoomFactor / originalZoomFactor;
            },

            canDrag: function () {
                return this.options.draggableUnzoomed || !isCloseTo(this.zoomFactor, 1);
            },

            drag: function (center, lastCenter) {
                if (lastCenter) {
                    if (this.options.lockDragAxis) {
                        if (Math.abs(center.x - lastCenter.x) > Math.abs(center.y - lastCenter.y)) {
                            this.addOffset({
                                x: -(center.x - lastCenter.x),
                                y: 0
                            });
                        } else {
                            this.addOffset({
                                y: -(center.y - lastCenter.y),
                                x: 0
                            });
                        }
                    } else {
                        this.addOffset({
                            y: -(center.y - lastCenter.y),
                            x: -(center.x - lastCenter.x)
                        });
                    }
                    triggerEvent(this.el, this.options.dragUpdateEventName);
                    if (typeof this.options.onDragUpdate === "function") {
                        this.options.onDragUpdate(this, event);
                    }
                }
            },

            getTouchCenter: function (touches) {
                return this.getVectorAvg(touches);
            },

            getVectorAvg: function (vectors) {
                return {
                    x: vectors.map(function (v) { return v.x; }).reduce(sum) / vectors.length,
                    y: vectors.map(function (v) { return v.y; }).reduce(sum) / vectors.length
                };
            },

            addOffset: function (offset) {
                this.offset = {
                    x: this.offset.x + offset.x,
                    y: this.offset.y + offset.y
                };
            },

            sanitize: function () {
                if (this.options.preventSnapBack || this.options.animationDuration === 0) {
                    return;
                }
                if (this.zoomFactor < this.options.zoomOutFactor) {
                    this.zoomOutAnimation();
                } else if (this.isInsaneOffset(this.offset)) {
                    this.sanitizeOffsetAnimation();
                }
            },

            isInsaneOffset: function (offset) {
                var sanitizedOffset = this.sanitizeOffset(offset);
                return sanitizedOffset.x !== offset.x || sanitizedOffset.y !== offset.y;
            },

            sanitizeOffsetAnimation: function () {
                var targetOffset = this.sanitizeOffset(this.offset),
                    startOffset = {
                        x: this.offset.x,
                        y: this.offset.y
                    },
                    updateProgress = function (progress) {
                        this.offset.x = startOffset.x + progress * (targetOffset.x - startOffset.x);
                        this.offset.y = startOffset.y + progress * (targetOffset.y - startOffset.y);
                        this.update();
                    }.bind(this);

                this.animate(this.options.animationDuration, updateProgress, this.swing);
            },

            zoomOutAnimation: function () {
                if (this.zoomFactor === 1) {
                    return;
                }

                var startZoomFactor = this.zoomFactor,
                    zoomFactor = 1,
                    center = this.getCurrentZoomCenter(),
                    updateProgress = function (progress) {
                        this.scaleTo(startZoomFactor + progress * (zoomFactor - startZoomFactor), center);
                    }.bind(this);

                this.animate(this.options.animationDuration, updateProgress, this.swing);
            },

            updateAspectRatio: function () {
                this.unsetContainerY();
                if (this.isDocumentMode()) {
                    var factor = this.getInitialZoomFactor();
                    this.setContainerY(Math.round(this.el.offsetHeight * factor));
                } else if (this.container.parentElement) {
                    this.setContainerY(this.container.parentElement.offsetHeight);
                }
            },

            isDocumentMode: function () {
                if (this.options.fitWidth) return true;
                if (this.container && this.container.parentElement) {
                    return this.el.offsetHeight > this.container.parentElement.offsetHeight * 1.2;
                }
                return false;
            },

            getInitialZoomFactor: function () {
                if (!this.container || !this.el || !this.el.offsetWidth) return 1;
                var xZoomFactor = this.container.offsetWidth / this.el.offsetWidth;
                if (this.isDocumentMode()) {
                    return Math.min(1, xZoomFactor);
                }
                var yZoomFactor = (this.container.offsetHeight || 500) / (this.el.offsetHeight || 500);
                return Math.min(xZoomFactor, yZoomFactor);
            },

            getAspectRatio: function () {
                return this.el.offsetWidth / this.el.offsetHeight;
            },

            getCurrentZoomCenter: function () {
                var offsetLeft = this.offset.x - this.initialOffset.x;
                var centerX = -1 * this.offset.x - offsetLeft / (1 / this.zoomFactor - 1);

                var offsetTop = this.offset.y - this.initialOffset.y;
                var centerY = -1 * this.offset.y - offsetTop / (1 / this.zoomFactor - 1);

                if (isNaN(centerX) || !isFinite(centerX)) {
                    centerX = this.container ? this.container.offsetWidth / 2 : 150;
                }
                if (isNaN(centerY) || !isFinite(centerY)) {
                    centerY = this.container ? this.container.offsetHeight / 2 : 250;
                }

                return {
                    x: centerX,
                    y: centerY
                };
            },

            getTouches: function (event) {
                var rect = this.container.getBoundingClientRect();
                var scrollTop = document.documentElement.scrollTop || document.body.scrollTop;
                var scrollLeft = document.documentElement.scrollLeft || document.body.scrollLeft;
                var posTop = rect.top + scrollTop;
                var posLeft = rect.left + scrollLeft;

                return Array.prototype.slice.call(event.touches).map(function (touch) {
                    return {
                        x: touch.pageX - posLeft,
                        y: touch.pageY - posTop
                    };
                });
            },

            animate: function (duration, framefn, timefn, callback) {
                if (duration <= 0) {
                    framefn(1);
                    if (callback) {
                        callback();
                    }
                    this.update();
                    return;
                }
                var startTime = new Date().getTime(),
                    renderFrame = function () {
                        if (!this.inAnimation) {
                            return;
                        }
                        var frameTime = new Date().getTime() - startTime,
                            progress = frameTime / duration;
                        if (frameTime >= duration) {
                            framefn(1);
                            if (callback) {
                                callback();
                            }
                            this.update();
                            this.stopAnimation();
                            this.update();
                        } else {
                            if (timefn) {
                                progress = timefn(progress);
                            }
                            framefn(progress);
                            this.update();
                            requestAnimationFrame(renderFrame);
                        }
                    }.bind(this);
                this.inAnimation = true;
                requestAnimationFrame(renderFrame);
            },

            stopAnimation: function () {
                this.inAnimation = false;
            },

            swing: function (p) {
                return -Math.cos(p * Math.PI) / 2 + 0.5;
            },

            getContainerX: function () {
                return this.container.offsetWidth;
            },

            getContainerY: function () {
                return this.container.offsetHeight;
            },

            setContainerY: function (y) {
                return this.container.style.height = y + 'px';
            },

            unsetContainerY: function () {
                this.container.style.height = null;
            },

            setupMarkup: function () {
                this.container = buildElement('<div class="pinch-zoom-container"></div>');
                this.el.parentNode.insertBefore(this.container, this.el);
                this.container.appendChild(this.el);

                this.container.style.overflow = 'hidden';
                this.container.style.position = 'relative';
                this.container.style.width = '100%';
                this.container.style.maxWidth = '100%';
                this.container.style.margin = '0 auto';

                this.el.style.webkitTransformOrigin = '0 0';
                this.el.style.mozTransformOrigin = '0 0';
                this.el.style.msTransformOrigin = '0 0';
                this.el.style.oTransformOrigin = '0 0';
                this.el.style.transformOrigin = '0 0';
                this.el.style.touchAction = 'none';

                this.el.style.position = 'absolute';
                this.el.style.left = '0';
                this.el.style.top = '0';
            },

            end: function () {
                this.hasInteraction = false;
                this.stopAnimation();
                if (!this.options.preventSnapBack && this.options.animationDuration > 0) {
                    this.sanitize();
                }
                this.update();
            },

            bindEvents: function () {
                var self = this;
                detectGestures(this.container, this);

                this.resizeHandler = this.update.bind(this);
                window.addEventListener('resize', this.resizeHandler);
                Array.from(this.el.querySelectorAll('img')).forEach(function (imgEl) {
                    imgEl.addEventListener('load', self.update.bind(self));
                });

                if (this.el.nodeName === 'IMG') {
                    this.el.addEventListener('load', this.update.bind(this));
                }
            },

            update: function () {
                if (this.updatePlanned) {
                    return;
                }
                this.updatePlanned = true;

                window.setTimeout(function () {
                    this.updatePlanned = false;

                    if (this.isDocumentMode() && this.el && this.el.offsetHeight) {
                        var targetH = Math.round(this.el.offsetHeight * this.getInitialZoomFactor() * this.zoomFactor);
                        if (targetH > 0) {
                            this.setContainerY(targetH);
                        }
                    }

                    var zoomFactor = this.getInitialZoomFactor() * this.zoomFactor,
                        offsetX = -this.offset.x / zoomFactor,
                        offsetY = -this.offset.y / zoomFactor,
                        transform3d = 'scale3d(' + zoomFactor + ', ' + zoomFactor + ',1) ' + 'translate3d(' + offsetX + 'px,' + offsetY + 'px,0px)',
                        transform2d = 'scale(' + zoomFactor + ', ' + zoomFactor + ') ' + 'translate(' + offsetX + 'px,' + offsetY + 'px)',
                        removeClone = function () {
                            if (this.clone) {
                                this.clone.parentNode.removeChild(this.clone);
                                delete this.clone;
                            }
                        }.bind(this);

                    if (!this.options.use2d || this.hasInteraction || this.inAnimation) {
                        this.is3d = true;
                        removeClone();

                        this.el.style.webkitTransform = transform3d;
                        this.el.style.mozTransform = transform2d;
                        this.el.style.msTransform = transform2d;
                        this.el.style.oTransform = transform2d;
                        this.el.style.transform = transform3d;
                    } else {
                        if (this.is3d) {
                            this.clone = this.el.cloneNode(true);
                            this.clone.style.pointerEvents = 'none';
                            this.container.appendChild(this.clone);
                            window.setTimeout(removeClone, 200);
                        }

                        this.el.style.webkitTransform = transform2d;
                        this.el.style.mozTransform = transform2d;
                        this.el.style.msTransform = transform2d;
                        this.el.style.oTransform = transform2d;
                        this.el.style.transform = transform2d;

                        this.is3d = false;
                    }
                }.bind(this), 0);
            },

            enable: function () {
                this.enabled = true;
            },

            disable: function () {
                this.enabled = false;
            },

            destroy: function () {
                window.removeEventListener('resize', this.resizeHandler);
                if (this.container && this.container.parentNode) {
                    this.container.parentNode.insertBefore(this.el, this.container);
                    this.container.remove();
                    this.container = null;
                }
            },

            // Toolbar action helpers
            zoomIn: function (factor) {
                var step = factor || (1 / (this.options.zoomFactor || 0.8));
                var center = this.getCurrentZoomCenter();
                this.scaleTo(Math.min(this.options.maxZoom, this.zoomFactor * step), center);
                this.update();
            },

            zoomOut: function (factor) {
                var step = factor || (this.options.zoomFactor || 0.8);
                var center = this.getCurrentZoomCenter();
                this.scaleTo(Math.max(this.options.minZoom, this.zoomFactor * step), center);
                this.update();
            },

            reset: function () {
                this.zoomOutAnimation();
            },

            getZoom: function () {
                return this.zoomFactor;
            }
        };

        var detectGestures = function (el, target) {
            var interaction = null,
                fingers = 0,
                lastTouchStart = null,
                startTouches = null,
                setInteraction = function (newInteraction, event) {
                    if (interaction !== newInteraction) {
                        if (interaction && !newInteraction) {
                            switch (interaction) {
                                case "zoom":
                                    target.handleZoomEnd(event);
                                    break;
                                case 'drag':
                                    target.handleDragEnd(event);
                                    break;
                            }
                        }
                        switch (newInteraction) {
                            case 'zoom':
                                target.handleZoomStart(event);
                                break;
                            case 'drag':
                                target.handleDragStart(event);
                                break;
                        }
                    }
                    interaction = newInteraction;
                },
                updateInteraction = function (event) {
                    if (fingers === 2) {
                        setInteraction('zoom');
                    } else if (fingers === 1 && target.canDrag()) {
                        setInteraction('drag', event);
                    } else {
                        setInteraction(null, event);
                    }
                },
                targetTouches = function (touches) {
                    return Array.from(touches).map(function (touch) {
                        return { x: touch.pageX, y: touch.pageY };
                    });
                },
                getDistance = function (a, b) {
                    var x = a.x - b.x, y = a.y - b.y;
                    return Math.sqrt(x * x + y * y);
                },
                calculateScale = function (startTouches, endTouches) {
                    var startDistance = getDistance(startTouches[0], startTouches[1]),
                        endDistance = getDistance(endTouches[0], endTouches[1]);
                    return endDistance / startDistance;
                },
                cancelEvent = function (event) {
                    event.stopPropagation();
                    event.preventDefault();
                },
                detectDoubleTap = function (event) {
                    var time = new Date().getTime();
                    if (fingers > 1) {
                        lastTouchStart = null;
                    }
                    if (time - lastTouchStart < 300) {
                        cancelEvent(event);
                        target.handleDoubleTap(event);
                        switch (interaction) {
                            case "zoom":
                                target.handleZoomEnd(event);
                                break;
                            case 'drag':
                                target.handleDragEnd(event);
                                break;
                        }
                    } else {
                        target.isDoubleTap = false;
                    }
                    if (fingers === 1) {
                        lastTouchStart = time;
                    }
                },
                firstMove = true;

            el.addEventListener('touchstart', function (event) {
                if (target.enabled) {
                    firstMove = true;
                    fingers = event.touches.length;
                    detectDoubleTap(event);
                }
            }, { passive: false });

            el.addEventListener('touchmove', function (event) {
                if (target.enabled && !target.isDoubleTap) {
                    if (firstMove) {
                        updateInteraction(event);
                        if (interaction) {
                            cancelEvent(event);
                        }
                        startTouches = targetTouches(event.touches);
                    } else {
                        switch (interaction) {
                            case 'zoom':
                                if (startTouches.length == 2 && event.touches.length == 2) {
                                    target.handleZoom(event, calculateScale(startTouches, targetTouches(event.touches)));
                                }
                                break;
                            case 'drag':
                                target.handleDrag(event);
                                break;
                        }
                        if (interaction) {
                            cancelEvent(event);
                            target.update();
                        }
                    }
                    firstMove = false;
                }
            }, { passive: false });

            el.addEventListener('touchend', function (event) {
                if (target.enabled) {
                    fingers = event.touches.length;
                    updateInteraction(event);
                }
            });
        };

        return PinchZoom;
    };

    var PinchZoom = definePinchZoom();
    exports.default = PinchZoom;
});
