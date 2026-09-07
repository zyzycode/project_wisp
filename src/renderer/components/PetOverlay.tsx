import React from 'react';
import { PET_PRESENTATION_LAYOUT } from '../../shared/pet-presentation-layout';
import { CharacterRenderer } from './Character/CharacterRenderer';
import { ChatInput } from './Chat/ChatInput';
import { SpeechBubble } from './Chat/SpeechBubble';
import { DebugHUD } from './Debug';
import { ContextMenu } from './Interaction/ContextMenu';
import type { useDesktopPetController } from '../hooks/useDesktopPetController';

export interface PetOverlayProps {
  readonly model: ReturnType<typeof useDesktopPetController>;
}

/** Pure React surface for the state and callbacks composed by DesktopPet. */
export const PetOverlay: React.FC<PetOverlayProps> = ({ model }) => {
  const debugHud = (
    <DebugHUD
      needs={model.debugTelemetry.character.needs}
      relationship={model.debugTelemetry.character.relationship}
      tone={model.debugTelemetry.character.synthesizedTone}
      animationState={model.animState}
      animationIntent={model.characterAnimationIntent}
      fps={model.renderFps}
      logs={model.debugTelemetry.logs}
      position={model.position}
      isWandering={model.isWandering}
      flipX={model.flipX}
      currentFace={model.customFace}
      bodyAnimationKeys={model.manifestAnimations.bodyKeys}
      faceAnimationKeys={model.manifestAnimations.faceKeys}
      selectedBodyAnimationKey={model.inspectorBodyKey}
      selectedFaceAnimationKey={model.inspectorFaceKey}
      showAnchorPoint={model.showAnchorPoint}
      onClearLogs={model.clearDebugLogs}
      onSelectBodyAnimation={(key) => {
        model.setInspectorBodyKey(key);
        if (key === null) model.setInspectorFaceKey(null);
      }}
      onSelectManifestFace={model.setInspectorFaceKey}
      onToggleAnchorPoint={() => model.setShowAnchorPoint((visible) => !visible)}
    />
  );

  return (
    <div
      className={`pet-container ${model.isDragging ? 'is-dragging' : ''} ${model.isWandering ? 'is-wandering' : ''} ${model.menuOpen ? 'menu-is-open' : ''}`}
      style={{ paddingLeft: PET_PRESENTATION_LAYOUT.characterRect.x,
        paddingTop: PET_PRESENTATION_LAYOUT.characterRect.y }}
    >
      <SpeechBubble message={model.dialogue.currentMessage} onDismiss={model.dialogue.dismissMessage} />
      <ChatInput
        canSubmit={model.dialogue.canSubmit}
        errorMessage={model.dialogue.error}
        isOpen={model.dialogue.chatOpen}
        onSendMessage={model.dialogue.handleSendMessage}
        onClose={model.dialogue.closeChat}
      />
      <ContextMenu
        isOpen={model.menuOpen}
        tone={model.debugTelemetry.character.synthesizedTone}
        currentTheme={model.currentTheme}
        scale={model.scale}
        autoWanderEnabled={model.autoWanderEnabled}
        quietMode={model.quietMode}
        onToggleQuietMode={model.toggleQuietMode}
        isSleeping={model.isSleeping}
        debugHudEnabled={model.debugHudEnabled}
        debugHudVisible={model.debugHudVisible}
        isAlwaysOnTop={model.isAlwaysOnTop}
        debugContent={debugHud}
        currentFace={model.customFace}
        onClose={() => model.setMenuOpen(false)}
        onPet={model.petFromMenu}
        onPlay={model.playFromMenu}
        onFeed={model.feedFromMenu}
        onThink={model.showRandomThought}
        onToggleSleep={model.toggleSleep}
        onToggleWander={model.toggleWander}
        onToggleDebugHud={() => model.setDebugHudVisible((visible) => !visible)}
        onToggleAlwaysOnTop={model.toggleAlwaysOnTop}
        onResetPosition={model.handleResetPosition}
        onPlayAnimation={model.handlePlayAnimation}
        onSelectFace={model.handleSelectFace}
        onSelectTheme={model.setCurrentTheme}
        onSelectScale={model.setScale}
        onQuit={model.closeApp}
      />
      <CharacterRenderer
        expression={model.expression}
        theme={model.currentTheme}
        scale={model.scale}
        visualState={model.visualState}
        isDragging={model.isDragging}
        debugAnimationSelection={model.debugAnimationSelection}
        showAnchorPoint={model.showAnchorPoint}
        onManifestAnimationsLoaded={model.setManifestAnimations}
        onAnimationCompleted={model.handleAnimationCompleted}
        onAnimationRejected={model.handleAnimationRejected}
        onGazeDirectionChanged={model.handleGazeDirectionChanged}
        gazeEnabled={model.cursorObservationEnabled}
        onCursorObserved={model.handleCursorObserved}
        onPointerDown={model.drag.onPointerDown}
        onClick={model.handlePetClick}
        onDoubleClick={model.handlePetDoubleClick}
        onContextMenu={model.handleContextMenu}
      />
      {model.debugHudEnabled && model.debugHudVisible && !model.menuOpen ? debugHud : null}
      <div className="pet-label" data-wisp-interactive="true" onClick={model.toggleChat}>
        💬 Wisp • {model.isWandering ? 'wandering' : model.animState}{' '}
        {model.debugTelemetry.character.synthesizedTone === 'affectionate' ? '💖' : ''}
      </div>
    </div>
  );
};
